import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Function } from 'sst/constructs'
import type { App } from 'sst/constructs'
import type { SSTConstruct } from 'sst/constructs/Construct'
import { TimeToLive } from '@cloudcomponents/cdk-temp-stack'
import settings from './settings'

export interface BaseStack {
  vpc?: ec2.Vpc
  cluster?: ecs.Cluster
  securityGroup?: ec2.SecurityGroup
}

interface Resource {
  addEnvironment(key: string, value: string): any
}

export const autoKill = (scope: App, stack: cdk.Stack): TimeToLive | null => {
  const { timeToLive } = settings(scope)
  if (!timeToLive) {
    return null
  }

  // if (stack.nestedStackParent) {
  //   console.log(`${stack.artifactId} is nested in ${stack.nestedStackParent.artifactId}. PARENT STACK WILL BE KILLED INSTEAD!`)
  //   return autoKill(scope, stack.nestedStackParent)
  // }

  if (scope.mode !== 'remove') {
    console.log(
      `Setting time to live for '${stack.artifactId}' as ${timeToLive.toMinutes()} minutes`
    )
  }

  return new TimeToLive(stack, `${stack.stackName}-autokill`, {
    ttl: timeToLive,
  })
}

export const bind = (construct: Resource, constructs: SSTConstruct[]) =>
  Function.prototype.bind.bind({
    allBindings: [],
    addEnvironment: construct.addEnvironment.bind(construct),
    attachPermissions: Function.prototype.attachPermissions.bind(construct),
  })(constructs)
