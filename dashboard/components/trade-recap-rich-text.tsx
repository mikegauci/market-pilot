"use client";

import { Fragment } from "react";
import {
  RECAP_TOKEN_PATTERN,
  recapTokenClassName,
  styleRecapToken,
  type TradeRecapTone,
} from "@/lib/trade-recap/rich-text";

export function TradeRecapRichText({
  text,
  tone,
}: {
  text: string;
  tone?: TradeRecapTone;
}) {
  const parts = text.split(RECAP_TOKEN_PATTERN);
  let offset = 0;

  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        const before = text.slice(0, offset);
        offset += part.length;
        const style = styleRecapToken(part, before, tone);
        const className = recapTokenClassName(style);
        if (className) {
          return (
            <span key={`${index}-${part.slice(0, 12)}`} className={className}>
              {part}
            </span>
          );
        }
        return <Fragment key={`${index}-${part.slice(0, 12)}`}>{part}</Fragment>;
      })}
    </>
  );
}
