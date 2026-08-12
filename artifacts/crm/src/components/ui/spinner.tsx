import { cn } from '@/lib/utils';
function Spinner({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('spinner', className)}
      {...props}
    />
  );
}

export { Spinner };
