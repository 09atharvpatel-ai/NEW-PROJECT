import React, { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";

/**
 * CountUp — animates from 0 to `value` when scrolled into view.
 * Renders prefix + number + suffix. Preserves formatting.
 */
export default function CountUp({
  value,
  duration = 1.8,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
  format = null, // (n:number)=>string
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => {
    const n = Number.isFinite(v) ? v : 0;
    return format
      ? format(n)
      : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  });
  const [text, setText] = useState(format ? format(0) : "0");

  useEffect(() => {
    if (!inView) return;
    const target = Number(value);
    if (!Number.isFinite(target)) return;
    const controls = animate(mv, target, {
      duration,
      ease: [0.2, 0.8, 0.2, 1],
    });
    const unsub = rounded.on("change", (v) => setText(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [inView, value, duration, mv, rounded]);

  return (
    <motion.span ref={ref} className={className}>
      {prefix}
      {text}
      {suffix}
    </motion.span>
  );
}
