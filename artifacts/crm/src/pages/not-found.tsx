import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold font-display text-foreground">
              404 Page Not Found
            </h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The requested page could not be found.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
