import { redirect } from "next/navigation";
import { HOLDING_OS_RNB_URL } from "@/lib/holdingOs";

export default function Home() {
  redirect(HOLDING_OS_RNB_URL);
}
