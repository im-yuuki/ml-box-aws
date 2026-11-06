"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SearchField } from "@heroui/react";
import { useTranslations } from "next-intl";

/**
 * Global search. Submitting opens the Projects list filtered by `?q=`; the
 * Projects page reads that parameter as its initial query.
 */
export default function NavbarSearch() {
  const t = useTranslations("navbar");
  const router = useRouter();
  const [value, setValue] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = value.trim();
    router.push(q ? `/projects?q=${encodeURIComponent(q)}` : "/projects");
  };

  return (
    <form role="search" className="workspace-navbar-search" onSubmit={submit}>
      <SearchField
        value={value}
        onChange={setValue}
        aria-label={t("searchLabel")}
        fullWidth
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t("searchPlaceholder")} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
    </form>
  );
}
