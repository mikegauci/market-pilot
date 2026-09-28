import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: { mark: 24, text: "text-base" },
  md: { mark: 32, text: "text-lg" },
  lg: { mark: 40, text: "text-2xl" },
} as const;

export function Logo({ className, showText = true, size = "md" }: LogoProps) {
  const { mark, text } = sizes[size];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/logo-mark.svg"
        alt=""
        width={mark}
        height={mark}
        priority
        aria-hidden
      />
      {showText ? (
        <span className={cn("font-semibold tracking-tight text-zinc-50", text)}>
          Market Pilot
        </span>
      ) : null}
    </div>
  );
}
