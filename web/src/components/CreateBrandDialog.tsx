import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useBrand } from "../brand";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Input,
  Textarea,
} from "./ui";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || ""
  );
}

/**
 * Create-brand modal (Radix Dialog). Captures the brand name and a one-sentence
 * seed, then routes into the brand profile in onboarding mode so the AI drafts
 * the Why/How/What from that sentence. `trigger` lets callers supply their own
 * opener element; `onCreated` still fires for callers that need the new id.
 */
export function CreateBrandDialog({
  trigger,
  onCreated,
}: {
  trigger: ReactNode;
  onCreated?: (brandId: string) => void;
}) {
  const navigate = useNavigate();
  const { switchBrand, refresh } = useBrand();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setSeed("");
    setError("");
    setBusy(false);
  };

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const submit = async () => {
    const finalSlug = slugify(effectiveSlug);
    if (!name.trim() || !finalSlug) {
      setError("Name and a valid slug are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Create the brand empty (no description) so the profile opens on the
      // draft hero; the seed is handed forward via route state, not persisted
      // until the AI draft is applied and autosaved.
      const { id } = await api.createBrand({
        name: name.trim(),
        slug: finalSlug,
      });
      await refresh();
      await switchBrand(id);
      onOpenChange(false);
      onCreated?.(id);
      navigate(`/brands/${id}/settings`, {
        state: { seed: seed.trim() || undefined, onboarding: true },
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(
        err.status === 409
          ? "A brand with that slug already exists — pick another."
          : err.message,
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="New brand"
        description="Name it and tell us what it's about — we'll draft the profile next."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <Field label="Brand name">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zenith Studio"
              />
            )}
          </Field>
          <Field
            label="Slug"
            hint="Used in URLs. Auto-filled from the name; lowercase and dashes only."
          >
            {(id) => (
              <Input
                id={id}
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="zenith-studio"
              />
            )}
          </Field>
          <Field
            label="In a sentence, what's this brand about? (optional)"
            hint="We'll draft your belief, voice and content themes from this. You can skip and start blank."
          >
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="A booking app that helps indie barbers fill empty chairs."
              />
            )}
          </Field>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create & continue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
