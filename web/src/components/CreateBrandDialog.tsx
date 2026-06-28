import { useState, type ReactNode } from "react";
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
 * Create-brand modal (Radix Dialog). On success, switches to the new brand and
 * calls onCreated. `trigger` lets callers supply their own opener element.
 */
export function CreateBrandDialog({
  trigger,
  onCreated,
}: {
  trigger: ReactNode;
  onCreated?: (brandId: string) => void;
}) {
  const { switchBrand, refresh } = useBrand();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
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
      const { id } = await api.createBrand({
        name: name.trim(),
        slug: finalSlug,
        description: description.trim() || undefined,
      });
      await refresh();
      await switchBrand(id);
      onOpenChange(false);
      onCreated?.(id);
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
        description="Spin up another brand in this workspace."
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
          <Field label="One-line description (optional)">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this brand is about"
              />
            )}
          </Field>
          {error && (
            <p className="text-sm text-red-600" role="alert">
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
              {busy ? "Creating…" : "Create brand"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
