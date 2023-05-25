#!/usr/bin/env bash
set -eu -o pipefail -E
cd `dirname "$0"`
cd ..

STACK=$(cat .sst/outputs.json | fx ".['$1']")

CLUSTER=$(echo $STACK | fx ".cluster")
echo "CLUSTER: $CLUSTER"

TASK_DEFINITION=$(echo $STACK | fx ".['taskdefinition']")
echo "TASK_DEFINITION: $TASK_DEFINITION"

SERVICE=$(echo $STACK | fx ".service")
echo "SERVICE: $SERVICE"

CONTAINER=$(echo $STACK | fx ".container")
echo "CONTAINER: $CONTAINER"

TASKS=$(aws ecs list-tasks --region us-east-2 --cluster "$CLUSTER" --desired-status RUNNING --query "taskArns" --output text)
echo "TASKS: $TASKS"

TASK=$(aws ecs describe-tasks --region us-east-2 --cluster "$CLUSTER" --tasks "$TASKS" --query "tasks[?contains(@.taskDefinitionArn, '$TASK_DEFINITION')].taskArn" --output text)
echo "TASK: $TASK"

aws ecs execute-command --region us-east-2 --cluster "$CLUSTER" --task $(basename "$TASK") --container "$CONTAINER" --interactive --command "/bin/bash"