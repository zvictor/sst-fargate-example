import * as os from 'node:os'
import { Duration } from '@aws-cdk/core'
import type { App } from 'sst/constructs'
import { RemovalPolicy } from 'aws-cdk-lib'

const settings = {
  production: {},
  [os.userInfo().username]: {
    timeToLive: Duration.minutes(55),
    defaultRemovalPolicy: RemovalPolicy.DESTROY,
  },
}

export default (scope: App) => {
  const stage = scope.stage.split('-')[0]
  return {
    ...settings[stage as keyof typeof settings],
    stage,
    coloredStage: scope.stage,
  }
}
