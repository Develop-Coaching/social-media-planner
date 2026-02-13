import { supabase } from "@/lib/supabase";

export interface OnboardingResponses {
  businessName: string;
  industry: string;
  targetAudience: string;
  teamSize: string;
  serviceArea: string;
  brandVoice: string[];
  contentTopics: string;
  website: string;
  socialPlatforms: string[];
  postingFrequency: string;
  contentTypes: string[];
  uniqueValue: string;
  slackWebhookUrl?: string;
  slackEditorWebhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
}

export async function saveOnboardingResponses(
  userId: string,
  responses: OnboardingResponses
): Promise<void> {
  const { error } = await supabase
    .from("onboarding_responses")
    .upsert({
      user_id: userId,
      responses,
      completed_at: new Date().toISOString(),
    });

  if (error) throw new Error(error.message);
}

export async function createCompanyFromOnboarding(
  userId: string,
  responses: OnboardingResponses
): Promise<string> {
  const companyId = crypto.randomUUID();

  const { error } = await supabase.from("companies").insert({
    user_id: userId,
    id: companyId,
    name: responses.businessName,
    website: responses.website || null,
    social_platforms: responses.socialPlatforms.length > 0 ? responses.socialPlatforms : null,
    slack_webhook_url: responses.slackWebhookUrl || null,
    slack_editor_webhook_url: responses.slackEditorWebhookUrl || null,
    slack_bot_token: responses.slackBotToken || null,
    slack_channel_id: responses.slackChannelId || null,
  });

  if (error) throw new Error(error.message);
  return companyId;
}

export function buildBrandBrief(responses: OnboardingResponses): string {
  const sections: string[] = [];

  sections.push(`# Brand Brief: ${responses.businessName}`);
  sections.push("");
  sections.push(`## Construction Type`);
  sections.push(responses.industry);
  sections.push("");

  if (responses.teamSize) {
    sections.push(`## Team Size`);
    sections.push(responses.teamSize);
    sections.push("");
  }

  if (responses.serviceArea) {
    sections.push(`## Service Area`);
    sections.push(responses.serviceArea);
    sections.push("");
  }

  sections.push(`## Target Audience`);
  sections.push(responses.targetAudience);
  sections.push("");
  sections.push(`## Brand Voice & Personality`);
  sections.push(responses.brandVoice.join(", "));
  sections.push("");
  sections.push(`## Key Content Topics`);
  sections.push(responses.contentTopics);
  sections.push("");

  if (responses.website) {
    sections.push(`## Website`);
    sections.push(responses.website);
    sections.push("");
  }

  sections.push(`## Social Media Platforms`);
  sections.push(responses.socialPlatforms.join(", "));
  sections.push("");
  sections.push(`## Posting Frequency`);
  sections.push(responses.postingFrequency);
  sections.push("");
  sections.push(`## Primary Content Types`);
  sections.push(responses.contentTypes.join(", "));
  sections.push("");
  sections.push(`## Unique Value Proposition`);
  sections.push(responses.uniqueValue);

  return sections.join("\n");
}

export async function createMemoryFromOnboarding(
  userId: string,
  companyId: string,
  responses: OnboardingResponses
): Promise<void> {
  const briefContent = buildBrandBrief(responses);

  const { error } = await supabase.from("memory_files").insert({
    user_id: userId,
    company_id: companyId,
    name: "Brand Brief (Onboarding)",
    content: briefContent,
    added_at: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
}
