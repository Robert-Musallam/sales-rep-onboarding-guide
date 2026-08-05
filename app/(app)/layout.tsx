import { redirect } from "next/navigation";
import { Shell } from "@/components/os/Shell";
import { getSessionUser } from "@/lib/os/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  return (
    <Shell
      email={session.email}
      role={session.profile?.role ?? "staff"}
      fullName={session.profile?.full_name}
    >
      {children}
    </Shell>
  );
}
