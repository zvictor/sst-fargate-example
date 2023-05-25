import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Construct } from 'constructs'
import type { SSTConstruct } from 'sst/constructs/Construct'
import type { FunctionBindingProps } from 'sst/constructs/util/functionBinding'
import type { BaseStack } from '../utils.js'

const MEMORY_MIB = 512
const CPU = 256

export default class Redis extends Construct implements SSTConstruct {
  public readonly id: string
  public readonly redis: cdk.aws_ecs.FargateService
  public readonly endpointAddress: string
  public readonly endpointPort = 6379

  constructor(scope: Construct, id: string, { vpc, cluster, securityGroup }: BaseStack) {
    super(scope, id)
    this.id = id

    if (!vpc) {
      vpc = new ec2.Vpc(this, `${id}-Vpc`, {
        natGateways: 0,
        maxAzs: 2,
      })
    }

    if (!securityGroup) {
      securityGroup = new ec2.SecurityGroup(this, `${id}-security-group`, {
        vpc,
        allowAllOutbound: true,
      })
    }

    if (!cluster) {
      cluster = new ecs.Cluster(this, `${id}-Cluster`, {
        vpc,
      })
    }

    const loadBalancer = new elbv2.NetworkLoadBalancer(this, `${id}-LoadBalancer`, {
      vpc,
      internetFacing: true,
      loadBalancerName: `${id}-LoadBalancer`,
    })

    const listener = loadBalancer.addListener(`${id}-Listener`, {
      port: this.endpointPort,
      protocol: elbv2.Protocol.TCP,
    })

    const taskDefinition = new ecs.TaskDefinition(this, `${id}-TaskDefinition`, {
      family: `${id}-TaskDefinition`,
      memoryMiB: String(MEMORY_MIB),
      cpu: String(CPU),
      compatibility: ecs.Compatibility.FARGATE,
      networkMode: ecs.NetworkMode.AWS_VPC,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX, // ARM64
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

    const container = taskDefinition.addContainer(`${id}-Container`, {
      image: ecs.ContainerImage.fromRegistry('redis/redis-stack-server'),
      memoryReservationMiB: MEMORY_MIB,
      cpu: CPU,
      logging,
    })

    this.redis = new ecs.FargateService(this, `${id}-Service`, {
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

    container.addPortMappings({
      containerPort: this.endpointPort,
    })

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(this.endpointPort),
      'Allow access to Redis from anywhere'
    )

    listener.addTargets(`${id}-Target`, {
      port: this.endpointPort,
      targets: [this.redis],
      protocol: elbv2.Protocol.TCP,
      targetGroupName: `${id}-TargetGroup`,
    })

    this.endpointAddress = loadBalancer.loadBalancerDnsName

    new cdk.CfnOutput(this, 'RedisEndpointAddress', {
      value: this.endpointAddress,
      description: 'Redis Endpoint Address',
    })

    new cdk.CfnOutput(this, 'RedisEndpointPort', {
      value: String(this.endpointPort),
      description: 'Redis Endpoint Port',
    })
  }

  public getConstructMetadata() {
    return {
      type: 'Redis' as const,
      data: {
        name: this.redis.serviceName,
        url: this.endpointAddress,
      },
    }
  }

  /** @internal */
  public getFunctionBinding(): FunctionBindingProps {
    return {
      clientPackage: 'redis',
      variables: {
        url: {
          type: 'plain',
          value: `redis://${this.endpointAddress}:${this.endpointPort}`,
        },
      },
      permissions: {
        // 'sqs:*': [this.queueArn],
      },
    }
  }
}
