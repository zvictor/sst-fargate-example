import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs'
import * as elasticache from 'aws-cdk-lib/aws-elasticache'
import type { SSTConstruct } from 'sst/constructs/Construct'
import type { FunctionBindingProps } from 'sst/constructs/util/functionBinding'
import type { BaseStack } from '../utils.js'

export default class ElastiCache extends Construct implements SSTConstruct {
  public readonly id: string
  public readonly redis: cdk.aws_elasticache.CfnCacheCluster
  public readonly endpointAddress: string
  public readonly endpointPort = 6379

  constructor(scope: Construct, id: string, { vpc, securityGroup }: BaseStack) {
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

    securityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(this.endpointPort),
      `Allow connections to ${this.endpointPort} between instances in the same security group`
    )

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for ElastiCache',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
    })

    new ec2.InterfaceVpcEndpoint(this, 'ElastiCacheVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ELASTICACHE,
    })

    this.redis = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      autoMinorVersionUpgrade: true,
      cacheSubnetGroupName: subnetGroup.ref,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
      port: this.endpointPort,
    })

    this.endpointAddress = this.redis.attrRedisEndpointAddress

    new cdk.CfnOutput(this, 'RedisEndpointAddress', {
      value: this.redis.attrRedisEndpointAddress,
      description: 'ElastiCache Redis Endpoint Address',
    })

    new cdk.CfnOutput(this, 'RedisEndpointPort', {
      value: String(this.endpointPort),
      description: 'ElastiCache Redis Endpoint Port',
    })
  }

  public getConstructMetadata() {
    return {
      type: 'ElastiCache' as const,
      data: {
        name: this.redis.logicalId,
        url: this.redis.attrRedisEndpointAddress,
      },
    }
  }

  /** @internal */
  public getFunctionBinding(): FunctionBindingProps {
    return {
      clientPackage: 'elasticache',
      variables: {
        url: {
          type: 'plain',
          value: `redis://${this.redis.attrRedisEndpointAddress}:${this.redis.attrRedisEndpointPort}`,
        },
      },
      permissions: {
        // 'sqs:*': [this.queueArn],
      },
    }
  }
}
