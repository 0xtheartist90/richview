// What a task looks like to the pages (server and browser alike).

export const TASK_STATUSES = [
    'new',
    'planned',
    'in_progress',
    'peer_review',
    'review',
    'changes_requested',
    'blocked',
    'approved',
    /** Old rows only: no longer shown or set. */
    'rejected'
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Each status's label and colour (SRE's palette: gold is the work waiting for Richie). */
export const STATUS_META: Record<TaskStatus, { label: string; hex: string; short?: string }> = {
    new: { label: 'New', hex: '#c8ccd2' },
    planned: { label: 'Planned', hex: '#7ea6d8' },
    in_progress: { label: 'In progress', hex: '#a78bfa' },
    peer_review: { label: 'Peer review', short: 'Peer', hex: '#5fb8c2' },
    review: { label: 'Review', hex: '#d4b062' },
    changes_requested: { label: 'Changes requested', short: 'Changes', hex: '#c98a5a' },
    blocked: { label: 'Blocked', hex: '#f43f5e' },
    approved: { label: 'Done', hex: '#34d399' },
    rejected: { label: 'Rejected', hex: '#6b7280' }
};
/** On a phone, top to bottom: what needs Richie first, then what's stuck, the work under way, and what's done. */
export const PHONE_ORDER: TaskStatus[] = [
    'review',
    'changes_requested',
    'blocked',
    'peer_review',
    'in_progress',
    'planned',
    'new',
    'approved'
];
/** On a desktop, the columns left to right: a task's life. */
export const DESK_ORDER: TaskStatus[] = [
    'new',
    'planned',
    'in_progress',
    'peer_review',
    'review',
    'changes_requested',
    'blocked',
    'approved'
];

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
    /** The agent who peer-checks the work before Richie sees it, if any. */
    reviewer: string;
    peerCheckedAt: string | null;
    /** Made by a recurring template. */
    recurring: boolean;
    recurringId: string | null;
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
    updatedAt: string;
};
