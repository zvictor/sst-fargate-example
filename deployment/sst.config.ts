import { SSTConfig } from 'sst'
import MyFargateStack from './stacks/MyFargateStack'
import { autoKill } from './utils.js'
import settings from './settings.js'

export default {
  config() {
    return {
      name: 'sst-fargate-example',
    }
  },
  async stacks(app) {
    const { defaultRemovalPolicy } = settings(app)
    if (defaultRemovalPolicy) {
      console.log(`Default removal policy set: ${defaultRemovalPolicy}`)
      app.setDefaultRemovalPolicy(defaultRemovalPolicy)
    }

    await app.stack(MyFargateStack)

    for (const stack of app.node.children) {
      autoKill(app, stack)
    }
  },
} satisfies SSTConfig
