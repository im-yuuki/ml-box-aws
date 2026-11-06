import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import PaymentCheckout from "./PaymentCheckout";

export async function generateMetadata() {
  const t = await getTranslations("checkout");
  return { title: `${t("title")} · ML Box` };
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <PaymentCheckout />
    </Suspense>
  );
}
