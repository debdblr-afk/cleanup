import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-24 text-center">
      <h1 className="text-xl">Nothing at this address</h1>
      <p className="text-sm text-text-muted mt-2">The link may be old, or the page moved.</p>
      <Link href="/" className="inline-flex mt-6 h-10 px-4 items-center rounded-md bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hover">Go to the uploader</Link>
    </div>
  );
}
