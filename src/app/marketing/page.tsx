"use client";

import { useAuth } from "@/lib/auth-context";
import { Megaphone } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MarketingChatTab from "@/components/marketing/MarketingChatTab";
import SocialMediaTab from "@/components/marketing/SocialMediaTab";
import ShowcasesTab from "@/components/marketing/ShowcasesTab";

export default function MarketingPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">You don&apos;t have access to the Marketing page.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col -m-6 lg:-m-8">
      <Tabs defaultValue={0} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-teal-500/20 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone size={20} className="text-teal-400" />
            <h1 className="text-lg font-semibold text-foreground">Marketing</h1>
            <span className="w-2 h-2 rounded-full bg-teal-400" title="Active" />
          </div>
          <TabsList>
            <TabsTrigger value={0}>Social Media</TabsTrigger>
            <TabsTrigger value={1}>Showcases</TabsTrigger>
            <TabsTrigger value={2}>Chat</TabsTrigger>
          </TabsList>
        </div>

        {/* Tab content */}
        <TabsContent value={0} className="flex-1 min-h-0 overflow-y-auto">
          <SocialMediaTab />
        </TabsContent>
        <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
          <ShowcasesTab />
        </TabsContent>
        <TabsContent value={2} className="flex-1 min-h-0">
          <MarketingChatTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
