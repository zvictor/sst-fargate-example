/*
 * This file is a living proof of the failure of the human civilization.
 * It was supposed to be a gateway between ElasticCache and Redis on EC2
 * (which is already a failure on itself).
 *
 * However, Lambda can't connect to ElasticCache unless it's outside of the AWS managed cluster,
 * which makes is very complicated to enable internet access on.
 *
 * Fuck this shit! You are better of just using a friendly cloud managed service.
 *
 *  https://stackoverflow.com/questions/52992085/why-cant-an-aws-lambda-function-inside-a-public-subnet-in-a-vpc-connect-to-the
 */

import { Construct } from 'constructs'
import ElastiCache from './ElastiCacheConstruct.js'
import RedisFargate from './RedisFargateConstruct.js'
import { BaseStack } from '../utils.js'

export default (scope: Construct, id: string, base: BaseStack) => {
  // https://stackoverflow.com/q/21917661
  if (process.env['LOCAL']) {
    return new RedisFargate(scope, id, base)
  } else {
    return new ElastiCache(scope, id, base)
  }
}
