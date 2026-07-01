"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, BookOpen, Trash2, Loader2, Search, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import type { KnowledgeDocument } from "@/lib/types";

interface SearchResult {
  id: string;
  document_id: string;
  content: string;
  section_number: string | null;
  section_title: string | null;
  page_number: number | null;
  chunk_index: number;
  similarity: number;
}

const STATUS_STYLES: Record<string, string> = {
  processing: "bg-amber-100 text-amber-700",
  ready: "bg-teal-100 text-teal-700",
  error: "bg-red-100 text-red-700",
};

export function KnowledgeBaseTab() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload dialog
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadStandardId, setUploadStandardId] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deleteDoc, setDeleteDoc] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge/documents");
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchDocuments]);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/knowledge/documents");
      if (res.ok) {
        const data: KnowledgeDocument[] = await res.json();
        setDocuments(data);
        const hasProcessing = data.some((d) => d.status === "processing");
        if (!hasProcessing && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 3000);
  }

  async function handleUpload() {
    if (!uploadFile || !uploadName.trim() || !uploadStandardId.trim()) {
      toast.error("File, name, and standard ID are required");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("name", uploadName.trim());
      formData.append("standard_id", uploadStandardId.trim());
      if (uploadDescription.trim()) {
        formData.append("description", uploadDescription.trim());
      }

      const res = await fetch("/api/knowledge/ingest", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        toast.success("Document uploaded — ingestion started");
        setShowUpload(false);
        resetUploadForm();
        fetchDocuments();
        startPolling();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
  }

  function resetUploadForm() {
    setUploadFile(null);
    setUploadName("");
    setUploadStandardId("");
    setUploadDescription("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete() {
    if (!deleteDoc) return;
    setDeleting(true);
    const res = await fetch(`/api/knowledge/documents/${deleteDoc.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success(`"${deleteDoc.name}" deleted`);
      setDeleteDoc(null);
      fetchDocuments();
    } else {
      toast.error("Failed to delete document");
    }
    setDeleting(false);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), limit: 5 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      } else {
        toast.error("Search failed");
        setSearchResults([]);
      }
    } catch {
      toast.error("Search failed");
      setSearchResults([]);
    }
    setSearching(false);
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Knowledge Base
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage RAG documents for the Field Operations agent.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
        >
          <Plus size={16} />
          Upload Document
        </button>
      </div>

      {/* Document List */}
      {documents.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <BookOpen
            size={48}
            className="mx-auto text-muted-foreground/30 mb-3"
          />
          <p className="text-muted-foreground">
            No documents yet. Upload your first standard.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Standard</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date Ingested</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium text-foreground">
                    {doc.name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 rounded-full"
                    >
                      {doc.standard_id}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {doc.chunk_count}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "text-[10px] px-1.5 py-0 rounded-full inline-flex items-center gap-1",
                        STATUS_STYLES[doc.status] || STATUS_STYLES.error,
                      )}
                    >
                      {doc.status === "processing" && (
                        <Loader2 size={10} className="animate-spin" />
                      )}
                      {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(doc.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => setDeleteDoc(doc)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Test Search */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Test Search</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verify the knowledge base returns relevant results.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. HVAC restoration procedures"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shrink-0"
          >
            {searching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>

        {/* Search Results */}
        {searching ? (
          <div className="text-center py-6 text-muted-foreground">
            <Loader2 size={20} className="animate-spin mx-auto mb-2" />
            Searching...
          </div>
        ) : hasSearched && searchResults.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matching chunks found.
          </p>
        ) : (
          searchResults.length > 0 && (
            <div className="space-y-3">
              {searchResults.map((result, i) => (
                <div
                  key={result.id}
                  className="border border-border rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        #{i + 1}
                      </span>
                      {result.section_number && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 rounded-full"
                        >
                          {result.section_number}
                        </Badge>
                      )}
                      {result.section_title && (
                        <span className="text-muted-foreground truncate">
                          {result.section_title}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-teal-600 shrink-0">
                      {(result.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {result.content}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Upload Dialog */}
      <Dialog
        open={showUpload}
        onOpenChange={(open) => {
          if (!open) resetUploadForm();
          setShowUpload(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                File *
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 transition-colors",
                  uploadFile && "border-primary/30 bg-primary/5",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setUploadFile(f);
                  }}
                />
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-foreground">
                    <Upload size={16} className="text-primary" />
                    {uploadFile.name}
                  </div>
                ) : (
                  <>
                    <Upload
                      size={24}
                      className="mx-auto text-muted-foreground/40 mb-2"
                    />
                    <p className="text-sm text-muted-foreground">
                      Click to select a .pdf or .docx file
                    </p>
                  </>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Document Name *
              </label>
              <Input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. IICRC S500 — Water Damage Restoration"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Standard ID *
              </label>
              <Input
                value={uploadStandardId}
                onChange={(e) => setUploadStandardId(e.target.value)}
                placeholder="e.g. S500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Description
              </label>
              <textarea
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="Optional description"
                className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent">
              Cancel
            </DialogClose>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {uploading && <Loader2 size={14} className="animate-spin" />}
              Upload
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteDoc}
        onOpenChange={(open) => !open && setDeleteDoc(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              {deleteDoc?.name}
            </span>
            ? This will permanently remove the document and all its embedded
            chunks.
          </p>
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent">
              Cancel
            </DialogClose>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-all"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
