import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <Image
        src="/nookleus-lockup.png"
        alt="Nookleus"
        width={200}
        height={136}
        priority
        className="h-16 w-auto mb-8"
      />
      <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
      <p className="text-sm text-muted-foreground mb-6">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Go back home
      </Link>
    </div>
  );
}
