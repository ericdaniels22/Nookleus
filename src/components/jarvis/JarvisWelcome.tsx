"use client";

import { useState } from "react";
import { Sparkles, FlaskConical, Megaphone, HardHat } from "lucide-react";
import JarvisQuickActions from "./JarvisQuickActions";
import NeuralNetwork3D from "./NeuralNetwork3D";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";
import type { BrainState } from "./neural-network/useNetworkAnimation";
import { JARVIS_CORE_STATIC_PROMPT } from "@/lib/jarvis/prompts/jarvis-core";
import { RND_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/rnd";
import { MARKETING_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/marketing";
import { FIELD_OPS_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/field-ops";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

const PROMPT_MAP: Record<string, string> = {
  "jarvis-core": JARVIS_CORE_STATIC_PROMPT,
  "rnd": RND_SYSTEM_PROMPT,
  "marketing": MARKETING_SYSTEM_PROMPT,
  "field-ops": FIELD_OPS_SYSTEM_PROMPT,
};

interface JarvisWelcomeProps {
  contextType: "general" | "job" | "rnd" | "marketing" | "field-ops";
  jobContext?: { customerName: string; address: string };
  onQuickAction: (text: string) => void;
  onInputFill?: (text: string) => void;
  brainState?: BrainState;
}

export default function JarvisWelcome({ contextType, jobContext, onQuickAction, onInputFill, brainState }: JarvisWelcomeProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleNodeClick = (agent: AgentConfig) => {
    setSelectedAgent(agent);
    setSheetOpen(true);
  };

  if (contextType === "marketing") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-700 flex items-center justify-center mb-5">
          <Megaphone size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-400 mb-2">Marketing Department</h2>
        <p className="text-base text-muted-foreground mb-1">Content creation, SEO, ads, social media & LLM optimization</p>
        <p className="text-sm text-muted-foreground/60 max-w-md mb-8">
          I create marketing content for AAA Disaster Recovery — Google Ads, blog posts, social media, review responses, and more. What do you need?
        </p>
        <JarvisQuickActions contextType="marketing" onSelect={onQuickAction} fillMode onFill={onInputFill} />
      </div>
    );
  }

  if (contextType === "field-ops") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-600 to-amber-700 flex items-center justify-center mb-5">
          <HardHat size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400 mb-2">Field Operations</h2>
        <p className="text-base text-muted-foreground mb-1">IICRC standards-backed restoration guidance</p>
        <p className="text-sm text-muted-foreground/60 max-w-md mb-8">
          I provide water damage, mold remediation, and fire/smoke restoration guidance backed by IICRC S500, S520, and S700 standards. Ask me about categories, PPE, equipment, drying, or any field question.
        </p>
        <JarvisQuickActions contextType="field-ops" onSelect={onQuickAction} />
      </div>
    );
  }

  if (contextType === "rnd") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center mb-5">
          <FlaskConical size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-400 mb-2">R&D Department</h2>
        <p className="text-base text-muted-foreground mb-1">Platform research, diagnostics & build specs</p>
        <p className="text-sm text-muted-foreground/60 max-w-md mb-8">
          I can read the codebase, query the database, search the web, and diagnose issues. Ask me anything about the platform.
        </p>
        <JarvisQuickActions contextType="rnd" onSelect={onQuickAction} />
      </div>
    );
  }

  if (contextType === "job" && jobContext) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4">
          <Sparkles size={28} className="text-primary-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">Jarvis</h3>
        <p className="text-sm text-muted-foreground max-w-xs mb-6">
          I&apos;m ready to help with the {jobContext.customerName} job. What do you need?
        </p>
        <JarvisQuickActions contextType="job" onSelect={onQuickAction} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-3">
        <NeuralNetwork3D
          brainState={brainState ?? { mode: "idle" }}
          onNodeClick={handleNodeClick}
        />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">Jarvis</h2>
      <p className="text-base text-muted-foreground mb-1">Your AI partner for AAA Disaster Recovery</p>
      <p className="text-sm text-muted-foreground/60 max-w-md">
        Ask me about your jobs, business metrics, marketing ideas, or anything else. I&apos;m here to help.
      </p>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-lg">
          {selectedAgent && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedAgent.name}</SheetTitle>
                <SheetDescription>{selectedAgent.role}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 mt-6">
                {selectedAgent.status === "active" ? (
                  <ActiveAgentDetails agent={selectedAgent} />
                ) : (
                  <PlannedAgentDetails agent={selectedAgent} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActiveAgentDetails({ agent }: { agent: AgentConfig }) {
  const systemPrompt = PROMPT_MAP[agent.id];
  return (
    <>
      <div><Badge variant="default">Active</Badge></div>
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">Model</h4>
        <p className="text-sm">{agent.model}</p>
      </div>
      {agent.endpoint && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Endpoint</h4>
          <code className="text-sm bg-muted px-2 py-0.5 rounded">{agent.endpoint}</code>
        </div>
      )}
      {agent.accessMethod && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Access</h4>
          <p className="text-sm">{agent.accessMethod}</p>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Tools</h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <Badge key={tool} variant="secondary" className="text-xs">{tool}</Badge>
            ))}
          </div>
        </div>
      )}
      {agent.config && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Config</h4>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
            {JSON.stringify(agent.config, null, 2)}
          </pre>
        </div>
      )}
      {systemPrompt && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">System Prompt (Static Template)</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Dynamic context (job details, business snapshot) is injected at runtime.
          </p>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap max-h-[500px] overflow-y-auto">
            {systemPrompt}
          </pre>
        </div>
      )}
    </>
  );
}

function PlannedAgentDetails({ agent }: { agent: AgentConfig }) {
  return (
    <>
      <Badge variant="outline">Planned — {agent.plannedBuild}</Badge>
      <p className="text-sm text-muted-foreground">
        This department hasn&apos;t been built yet. It&apos;s coming in {agent.plannedBuild}.
      </p>
      {agent.knowledgeSources && agent.knowledgeSources.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Planned Knowledge Sources</h4>
          <ul className="text-sm text-muted-foreground list-disc list-inside">
            {agent.knowledgeSources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
