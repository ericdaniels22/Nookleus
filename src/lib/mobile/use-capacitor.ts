"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

export function useCapacitor() {
  const [isNative, setIsNative] = useState<boolean | null>(null);
  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
  }, []);
  return { isNative, ready: isNative !== null };
}
