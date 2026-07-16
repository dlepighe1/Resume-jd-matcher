import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <SignIn fallbackRedirectUrl="/matcher" />
    </div>
  );
}
