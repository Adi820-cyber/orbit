import type { Entitlement, GuidedPrompt, MembershipClaims, Period } from '@orbit/contracts';
import { frameworkAssignment } from '../shared.ts';

/** How many of the role's highest-weighted assignments get prompts. A UX choice, not a scoring rule. */
export const PROMPTED_ASSIGNMENTS = 3;

/**
 * Guided prompts for one caller (PRD FR-05). Labels are built from the
 * framework's KPI titles and the caller's own entitlements; nothing here names
 * a facility, a target, or a value. Every prompt is a typed request the Ask
 * route re-authorizes when it is sent.
 */
export function guidedPrompts(
  membership: MembershipClaims,
  entitlements: readonly Entitlement[],
  period: Period,
): GuidedPrompt[] {
  const prompts: GuidedPrompt[] = [
    { promptId: 'summarize_exceptions', label: 'Summarize my open exceptions', request: { intent: 'summarize_exceptions' } },
  ];

  const ranked = entitlements
    .map((entitlement, order) => ({ entitlement, order, assignment: frameworkAssignment(membership, entitlement.assignmentId) }))
    .sort((a, b) => b.assignment.weight - a.assignment.weight || a.order - b.order)
    .slice(0, PROMPTED_ASSIGNMENTS);

  let breakdownOffered = false;
  for (const { entitlement, assignment } of ranked) {
    const { assignmentId, kpi } = assignment;
    const target = membership.scopes.find((scope) => entitlement.grains.includes(scope.grain));

    if (target) {
      prompts.push({
        promptId: `report_performance:${assignmentId}`,
        label: `Report ${kpi} for my ${target.grain} this period`,
        request: { intent: 'report_performance', assignmentId, target, period },
      });
      const breakdown = entitlement.breakdowns[0];
      if (!breakdownOffered && breakdown) {
        breakdownOffered = true;
        prompts.push({
          promptId: `explain_contributors:${assignmentId}`,
          label: `Break down ${kpi} by ${breakdown}`,
          request: { intent: 'explain_contributors', assignmentId, target, period, breakdown },
        });
      }
    }
    prompts.push({
      promptId: `explain_definition:${assignmentId}`,
      label: `Explain how ${kpi} is defined`,
      request: { intent: 'explain_definition', assignmentId },
    });
  }
  return prompts;
}
