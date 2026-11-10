"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Avatar, Button, Card, Form, Input, Label, ListBox, Select, Spinner, TextField } from "@heroui/react";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  initialsFor,
  isAcceptedAvatarFile,
  PROFILE_TIMEZONES,
  resizeAvatar,
  type AccountProfile,
} from "@/lib/account";
import EmailCard from "./EmailCard";
import FeedbackAlert from "@/components/FeedbackAlert";

type ProfileResponse = { profile?: AccountProfile };

const GENDER_OPTIONS = ["female", "male", "other", "prefer_not_to_say"] as const;

/** Personal details shown across MLBox, with the sign-in email. */
export default function ProfileCard() {
  const t = useTranslations("account");
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [timezone, setTimezone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const applyProfile = useCallback((next: AccountProfile) => {
    setProfile(next);
    setFullName(next.fullName ?? "");
    setJobTitle(next.jobTitle ?? "");
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(next.timezone ?? ((PROFILE_TIMEZONES as readonly string[]).includes(browserZone) ? browserZone : "UTC"));
    setBirthDate(next.birthDate ?? "");
    setGender(next.gender ?? "prefer_not_to_say");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await bffFetch("/api/bff/account/profile", { cache: "no-store" });
      if (!response.ok) throw new Error("profile");
      const body = (await response.json()) as ProfileResponse;
      if (!body.profile) throw new Error("profile");
      applyProfile(body.profile);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [applyProfile]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const response = await bffFetch("/api/bff/account/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, jobTitle, timezone, birthDate, gender }),
      });
      if (response.status === 400) throw new Error("profileInvalid");
      if (!response.ok) throw new Error("profileFailed");
      setProfile((current) => (current ? {
        ...current,
        fullName: fullName.trim() || null,
        jobTitle: jobTitle.trim() || null,
        timezone,
        birthDate: birthDate || null,
        gender,
      } : current));
      setMessage(t("profileSaved"));
    } catch (failure) {
      setError(t(failure instanceof Error && failure.message === "profileInvalid" ? "profileInvalid" : "profileFailed"));
    } finally {
      setSaving(false);
    }
  };

  const sendAvatar = async (dataUrl: string | null) => {
    setAvatarBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await bffFetch("/api/bff/account/avatar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!response.ok) {
        setError(t(response.status === 400 ? "avatarInvalid" : "profileFailed"));
        return;
      }
      setProfile((current) => (current ? { ...current, avatarDataUrl: dataUrl } : current));
    } catch {
      setError(t("profileFailed"));
    } finally {
      setAvatarBusy(false);
    }
  };

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAcceptedAvatarFile(file)) {
      setError(t("avatarInvalid"));
      return;
    }
    try {
      await sendAvatar(await resizeAvatar(file));
    } catch {
      setError(t("avatarInvalid"));
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm" role="status">
        <Spinner size="sm" />
        <span>{t("loading")}</span>
      </Card>
    );
  }

  if (loadError || !profile) {
    return (
      <Card className="flex flex-wrap items-center gap-3 p-5">
        <FeedbackAlert status="danger">{t("loadFailed")}</FeedbackAlert>
        <Button size="sm" variant="secondary" onPress={() => void load()}>
          {t("retry")}
        </Button>
      </Card>
    );
  }

  const zoneOptions = timezone && !(PROFILE_TIMEZONES as readonly string[]).includes(timezone)
    ? [timezone, ...PROFILE_TIMEZONES]
    : [...PROFILE_TIMEZONES];

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{t("profileHeading")}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="lg">
          {profile.avatarDataUrl ? <Avatar.Image src={profile.avatarDataUrl} alt="" /> : null}
          <Avatar.Fallback>{initialsFor(profile)}</Avatar.Fallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("avatarLabel")}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" isDisabled={avatarBusy} onPress={() => fileInput.current?.click()}>
              <ImagePlus aria-hidden="true" size={14} />
              {t("avatarChoose")}
            </Button>
            {profile.avatarDataUrl ? (
              <Button size="sm" variant="tertiary" isDisabled={avatarBusy} onPress={() => void sendAvatar(null)}>
                <Trash2 aria-hidden="true" size={14} />
                {t("avatarRemove")}
              </Button>
            ) : null}
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{t("avatarHint")}</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void chooseAvatar(event)}
          />
        </div>
      </div>

      <Form className="flex flex-col gap-4" onSubmit={saveProfile}>
        <TextField value={fullName} onChange={setFullName} autoComplete="name">
          <Label>{t("fullNameLabel")}</Label>
          <Input variant="secondary" fullWidth />
        </TextField>
        <TextField value={jobTitle} onChange={setJobTitle} autoComplete="organization-title">
          <Label>{t("jobTitleLabel")}</Label>
          <Input variant="secondary" fullWidth />
        </TextField>
        <TextField type="date" value={birthDate} onChange={setBirthDate} autoComplete="bday">
          <Label>{t("birthDateLabel")}</Label>
          <Input variant="secondary" fullWidth />
        </TextField>
        <Select selectedKey={gender} onSelectionChange={(key) => key && setGender(String(key))} variant="secondary">
          <Label>{t("genderLabel")}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {GENDER_OPTIONS.map((option) => (
                <ListBox.Item key={option} id={option} textValue={t(`gender.${option}`)}>
                  {t(`gender.${option}`)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Select selectedKey={timezone} onSelectionChange={(key) => key && setTimezone(String(key))} variant="secondary">
          <Label>{t("timezoneLabel")}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {zoneOptions.map((zone) => (
                <ListBox.Item key={zone} id={zone} textValue={zone}>
                  {zone.replace(/_/g, " ")}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {error ? (
          <FeedbackAlert status="danger">{error}</FeedbackAlert>
        ) : null}
        {message ? (
          <FeedbackAlert status="success">{message}</FeedbackAlert>
        ) : null}
        <Button type="submit" variant="primary" isPending={saving} isDisabled={saving} fullWidth>
          <Save aria-hidden="true" size={16} />
          {t("saveProfile")}
        </Button>
      </Form>

      <EmailCard email={profile.email} onChanged={(email) => setProfile((current) => (current ? { ...current, email } : current))} />
    </Card>
  );
}
