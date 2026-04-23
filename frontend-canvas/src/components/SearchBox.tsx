import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"

interface SearchBoxProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  label?: string
  className?: string
}

/**
 * A lightweight search input with a leading magnifier icon and a
 * trailing clear button. Used by every tool that filters a list of
 * assignments by original name.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label = "Search assignments by original name",
  className,
}: SearchBoxProps) {
  return (
    <div className={`relative min-w-[16rem] flex-1 ${className ?? ""}`}>
      <Search
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pr-8 pl-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
