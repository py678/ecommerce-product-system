import type { ReactNode } from 'react';

/** Shared heading for management lists, following the product catalog layout. */
export function ManagementPageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading management-page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="management-page-action">{action}</div>}
    </div>
  );
}
