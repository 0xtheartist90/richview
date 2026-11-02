// What a task looks like to the pages (server and browser alike).

export const TASK_STATUSES = [
    'idea',
    'planned',
    'in_progress',
    'review',
    'approved',
    'changes_requested',
    'rejected'
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DECISION_ACTIONS = ['approved', 'changes_requested', 'rejected', 'started'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export type Task = {
    id: string;
    title: string;
    summary: string;
    description: string;
    status: TaskStatus;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    domain: string;
    owner: string;
    project: { slug: string; name: string };
    impact: string;
    effort: string;
    previewUrl: string;
    images: string[];
    before: string;
    after: string;
    context: string;
    /** Sent back before with changes requested, and back for review. */
    returned: boolean;
    createdAt: string;
};
