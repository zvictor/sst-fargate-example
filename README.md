Relevant things to notice:

1. Only the `deployment` folder is present. You would need to setup services (e.g. `services/my-service`) and functions (e.g. `functions/my-function`) to make the deployment work.

1. `deployment/constructs` contains a few files related to ElastiCache and Redis. Those are trash, as I gave up on them and moved on to upstash. Feel free to ignore them.

1. `deployment/constructs/localService.ts` contains the PM2 logic, which is only used when `process.env['LOCAL']` is truthy. Otherwise, it deploy the Fargate stack as one would expect.

1. `deployment/scripts/attach.js` allows one to run commands inside the Fargate container. I haven't used in a while, so it might be needing some "oil".

1. `deployment/scripts/dev.js` is a WIP for a blue/green deployment. Why? Because Cloudwatch can take ages to remove/deploy sometimes and being able to just abandon the env/stack is crucial for DX. SST's watcher doesn't work when running `dev` this way.

1. `deployment/utils.ts` contains the custom `bind` logic that allows both Fargate and PM2 to "subscribe" to SST vars. This is probably the snippet that got outdated by sst v2.8+.

1. `autoKill` is a crucial construct that auto deletes the stack once a given time elapses. Crucial for an env like this, in which one can be running multiple Fargate instances in multiple envs (blue/green) and can forget about some of them.
