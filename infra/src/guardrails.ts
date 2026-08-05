import * as aws from '@pulumi/aws';
import type { StackConfig } from './config';

/**
 * Cost guardrails (SPEC.md §12a) — these land before any workload:
 *
 * - Monthly budget with alarms at 80% and 100% of the stack's limit (dev $5,
 *   prod $10), emailed to the configured address.
 * - Throughput caps live in database.ts (autoscaling max) and api.ts (Lambda
 *   reserved concurrency + gateway throttle) — this module is the alert side.
 *
 * The budget is a guardrail, not a kill-switch: it alerts so a human can run
 * `pulumi destroy`. Nothing in AWS stops spending programmatically at a
 * budget, and pretending otherwise would be the more dangerous lie.
 */
export function createBudgetGuardrail(config: StackConfig): void {
  const topic = new aws.sns.Topic(`budget-topic-${config.stack}`, {
    name: `config-scanner-budget-${config.stack}`,
  });

  new aws.sns.TopicSubscription(`budget-subscription-${config.stack}`, {
    topic: topic.arn,
    protocol: 'email',
    endpoint: config.budgetNotifyEmail,
  });

  new aws.budgets.Budget(`budget-${config.stack}`, {
    name: `config-scanner-${config.stack}-monthly`,
    budgetType: 'COST',
    limitAmount: config.budgetAmount.toString(),
    timeUnit: 'MONTHLY',
    notifications: [
      {
        comparisonOperator: 'GREATER_THAN',
        threshold: 80,
        thresholdType: 'PERCENTAGE',
        notificationType: 'ACTUAL',
        subscriberEmailAddresses: [config.budgetNotifyEmail],
      },
      {
        comparisonOperator: 'GREATER_THAN',
        threshold: 100,
        thresholdType: 'PERCENTAGE',
        notificationType: 'ACTUAL',
        subscriberEmailAddresses: [config.budgetNotifyEmail],
      },
    ],
  });
}
