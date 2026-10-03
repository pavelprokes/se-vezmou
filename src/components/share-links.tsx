"use client";

import { Mail, MessageCircle, MessageSquare, Share2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export interface ShareLabels {
  whatsapp: string;
  sms: string;
  email: string;
  /** Tlačítko systémového sdílení (jen tam, kde ho prohlížeč umí). */
  native: string;
  /** Předmět e-mailu. */
  subject: string;
  /** Text zprávy včetně adresy webu. */
  message: string;
}

const subscribe = () => () => {};
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Sdílení adresy webu s hosty přes WhatsApp, SMS a e-mail. Jsou to obyčejné odkazy (fungují bez
 * JavaScriptu, nic se neposílá přes naše servery); systémové sdílení se přidá, když ho zařízení umí.
 * PIN hostů se do zprávy nikdy nepřidává: patří k pozvánce, ne do skupinového chatu.
 */
export function ShareLinks({ labels }: { labels: ShareLabels }) {
  const nativeShare = useSyncExternalStore(subscribe, canShare, () => false);
  const text = encodeURIComponent(labels.message);
  const links = [
    {
      key: "whatsapp",
      icon: MessageCircle,
      label: labels.whatsapp,
      href: `https://wa.me/?text=${text}`,
    },
    { key: "sms", icon: MessageSquare, label: labels.sms, href: `sms:?&body=${text}` },
    {
      key: "email",
      icon: Mail,
      label: labels.email,
      href: `mailto:?subject=${encodeURIComponent(labels.subject)}&body=${text}`,
    },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          {...(link.key === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={buttonVariants({ variant: "secondary" })}
          data-testid={`share-${link.key}`}
        >
          <Icon icon={link.icon} size={18} />
          {link.label}
        </a>
      ))}
      {nativeShare ? (
        <button
          type="button"
          className={buttonVariants({ variant: "secondary" })}
          onClick={() =>
            void navigator.share({ title: labels.subject, text: labels.message }).catch(() => {})
          }
        >
          <Icon icon={Share2} size={18} />
          {labels.native}
        </button>
      ) : null}
    </div>
  );
}
