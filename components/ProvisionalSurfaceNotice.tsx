import React from 'react';
import { Card } from './UI';

interface ProvisionalSurfaceNoticeProps {
  title?: string;
  description: string;
}

export const ProvisionalSurfaceNotice: React.FC<ProvisionalSurfaceNoticeProps> = ({
  title = 'Surface provisoire locale',
  description,
}) => {
  return (
    <Card className="border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="text-sm font-medium text-amber-200">{title}</div>
      <p className="mt-1 text-xs text-amber-100/80">{description}</p>
    </Card>
  );
};