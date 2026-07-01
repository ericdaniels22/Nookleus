"use client";

import { useState, useEffect, useRef, Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import type * as THREE from "three";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";
import type { BrainState } from "./neural-network/useNetworkAnimation";

// Dynamic import — Three.js cannot run server-side
const NeuralNetworkScene = dynamic(
  () => import("./neural-network/NeuralNetworkScene"),
  { ssr: false }
);

// --- Error Boundary (class component required for componentDidCatch) ---

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WebGLErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    // Silently fall back — no error shown to user
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// --- Main Wrapper ---

interface NeuralNetwork3DProps {
  brainState: BrainState;
  onNodeClick: (agent: AgentConfig) => void;
  className?: string;
}

export default function NeuralNetwork3D({
  brainState,
  onNodeClick,
  className = "",
}: NeuralNetwork3DProps) {
  const [canvasReady, setCanvasReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  // Check reduced motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Cleanup GPU on unmount
  useEffect(() => {
    return () => {
      if (glRef.current) {
        glRef.current.dispose();
      }
    };
  }, []);

  const handleCreated = (gl: THREE.WebGLRenderer) => {
    glRef.current = gl;
    // Small delay for canvas to actually render a frame before crossfading
    requestAnimationFrame(() => setCanvasReady(true));
  };

  const sparklesFallback = (
    <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
      <Sparkles size={32} className="text-primary-foreground" />
    </div>
  );

  return (
    <div
      className={`relative w-[200px] h-[200px] md:w-[280px] md:h-[280px] mx-auto ${className}`}
      role="img"
      aria-label="Jarvis AI neural network visualization"
    >
      {/* Loading fallback — Sparkles icon with pulse */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${
          canvasReady ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        <div className="animate-pulse">
          {sparklesFallback}
        </div>
      </div>

      {/* 3D Canvas */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          canvasReady ? "opacity-100" : "opacity-0"
        }`}
      >
        <WebGLErrorBoundary fallback={sparklesFallback}>
          <NeuralNetworkScene
            brainState={brainState}
            reducedMotion={reducedMotion}
            onNodeClick={onNodeClick}
            onCreated={handleCreated}
          />
        </WebGLErrorBoundary>
      </div>
    </div>
  );
}
