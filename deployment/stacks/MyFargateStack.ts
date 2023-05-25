// based on https://github.com/georgeevans1995/cdk-templates/blob/main/cdk/lib/index.ts

import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as logs from 'aws-cdk-lib/aws-logs'
import { Config } from 'sst/config.js'
import { StackContext, EventBus, Queue, Function } from 'sst/constructs'
import { bind, BaseStack as BaseStackInterface } from '../utils.js'
import LocalService from '../constructs/localService.js'

const MEMORY_MIB = 2048
const CPU = 256

export class BaseStack extends cdk.Stack implements BaseStackInterface {
  public readonly vpc: ec2.Vpc
  public readonly securityGroup: ec2.SecurityGroup
  public readonly cluster: ecs.Cluster
  public readonly fileSystem: efs.FileSystem
  public readonly accessPoint: efs.AccessPoint

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, `${id}-Vpc`, {
      natGateways: 0,
      maxAzs: 2,
      enableDnsHostnames: true,
      enableDnsSupport: true,
    })

    const securityGroup = new ec2.SecurityGroup(this, `${id}-security-group`, {
      vpc,
      allowAllOutbound: true,
    })

    const cluster = new ecs.Cluster(this, `${id}-Cluster`, {
      vpc,
    })

    const fileSystem = new efs.FileSystem(this, `${id}-FileSystem`, {
      vpc,
      encrypted: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      securityGroup,
    })

    fileSystem.connections.allowInternally(ec2.Port.tcp(22))
    fileSystem.connections.allowInternally(ec2.Port.tcp(2049))

    const accessPoint = new efs.AccessPoint(this, `${id}-AccessPoint`, {
      fileSystem,
      path: '/data',
      createAcl: {
        ownerGid: '999',
        ownerUid: '999',
        permissions: '777',
      },
      posixUser: {
        uid: '999',
        gid: '999',
      },
    })

    this.vpc = vpc
    this.cluster = cluster
    this.securityGroup = securityGroup
    this.fileSystem = fileSystem
    this.accessPoint = accessPoint
  }
}

export class FargateStack extends cdk.Stack {
  public readonly container: ecs.ContainerDefinition
  public readonly service: ecs.FargateService

  constructor(
    scope: cdk.App,
    id: string,
    { vpc, securityGroup, cluster, fileSystem, accessPoint }: BaseStack,
    environment: Record<string, string>,
    props?: cdk.StackProps
  ) {
    super(scope, id, props)

    const volumeName = 'efs-data'

    const image = ecs.ContainerImage.fromAsset('../', {
      file: './services/my-service/deployment/Dockerfile',
      buildArgs: {
        SERVICE_FOLDER: `services/my-service`,
      },
    })

    const taskDefinition = new ecs.TaskDefinition(this, `${id}-TaskDefinition`, {
      family: `${id}-TaskDefinition`,
      memoryMiB: String(MEMORY_MIB),
      cpu: String(CPU),
      compatibility: ecs.Compatibility.FARGATE,
      networkMode: ecs.NetworkMode.AWS_VPC,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    })

    taskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
        },
      },
    })

    const logGroup = new logs.LogGroup(this, `${id}-ContainerLogGroup`, {
      logGroupName: `${id}-LogGroup`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    })

    const logging = new ecs.AwsLogDriver({
      logGroup,
      streamPrefix: id,
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
    })

    this.container = taskDefinition.addContainer(`${id}-Container`, {
      image,
      memoryReservationMiB: MEMORY_MIB / 2,
      cpu: CPU,
      logging,
      environment,
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:8080/health || exit 1`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    })

    this.container.addMountPoints({
      containerPath: '/data',
      sourceVolume: volumeName,
      readOnly: false,
    })

    this.service = new ecs.FargateService(this, `${id}-Service`, {
      enableExecuteCommand: true,
      taskDefinition,
      desiredCount: 1,
      cluster,
      vpcSubnets: { subnets: vpc.publicSubnets },
      securityGroups: [securityGroup],
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 100,
          base: 1,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
      assignPublicIp: true,
    })

    new cdk.CfnOutput(this, 'cluster', {
      value: cluster.clusterName,
    })

    new cdk.CfnOutput(this, 'taskdefinition', {
      value: taskDefinition.taskDefinitionArn,
    })

    new cdk.CfnOutput(this, 'service', {
      value: this.service.serviceName,
    })

    new cdk.CfnOutput(this, 'container', {
      value: this.container.containerName,
    })
  }
}

export default async function MyFargateStack(ctx: StackContext) {
  const MY_SECRET = (await Config.getSecret({ key: 'MY_SECRET' })) ?? ''
  const REDIS_URL = (await Config.getSecret({ key: 'REDIS_URL' })) ?? ''
  const baseStack = new BaseStack(ctx.app as any, `${ctx.app.stage}-my-service`)
  const bus = new EventBus(ctx.stack, `my-service-events`)

  const name = `my-service`
  const SERVICE_ID = `${ctx.app.stage}-${name}`

  const queue = new Queue(ctx.stack, `queue`, {
    cdk: {
      queue: {
        retentionPeriod: cdk.Duration.hours(12),
        // https://www.jeremydaly.com/serverless-consumers-with-lambda-and-sqs-triggers/
        visibilityTimeout: cdk.Duration.seconds(60),
      },
    },
  })

  const lambda = new Function(ctx.stack, `${name}-my-function`, {
    handler: '../functions/my-function/handler.default',
    runtime: 'nodejs18.x',
    environment: {
      DEBUG: 'sst-fargate-example:*',
      DEBUG_DEPTH: '10',
      NODE_OPTIONS: '--no-warnings --enable-source-maps',
      QUEUE_DESTINATION: queue.queueUrl,
      REDIS_URL,
      MY_SECRET,
    },
    memorySize: 128,
    reservedConcurrentExecutions: 1,
    timeout: 60, // seconds
  })

  lambda.bind([queue])

  bus.addRules(ctx.stack, {
    [`${name}-relay`]: {
      pattern: {
        source: [SERVICE_ID],
        detailType: ['my-service-pattern'],
      },
      targets: {
        messageGenerator: {
          type: 'function',
          function: lambda,
        },
      },
    },
  })

  const env = {
    DEBUG: 'sst-fargate-example:*',
    DEBUG_DEPTH: '10',
    NODE_OPTIONS: `--no-warnings --enable-source-maps --max-old-space-size=${Math.floor(
      (MEMORY_MIB * 4) / 5
    )}`,
    MY_SECRET,
    SERVICE_ID,
    REDIS_URL,
  }

  let instance
  if (process.env['LOCAL']) {
    instance = new LocalService(ctx.app, SERVICE_ID, {
      env,
      script: 'server.ts',
      cwd: '../services/my-service',
    })

    await instance.container.run()
  } else {
    instance = new FargateStack(ctx.app as any, SERVICE_ID, baseStack, env)

    bus.cdk.eventBus.grantPutEventsTo(instance.service.taskDefinition.taskRole)
    queue.cdk.queue.grantConsumeMessages(instance.service.taskDefinition.taskRole)
  }

  bind(instance.container, [bus, queue])
}
