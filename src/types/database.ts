// Hand-written to mirror `supabase gen types typescript --linked --schema public`.
// Re-generate with `pnpm db:types` once the Supabase project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "pending" | "student" | "teacher";
export type UserStatus = "active" | "suspended";
export type MessageDirection = "in" | "out";
export type MessageKind = "voice" | "video_note" | "text" | "photo" | "video" | "audio";
export type MediaKind = "photo" | "video" | "audio";
export type OnboardingVideoStep = "video1" | "video2" | "video3";
export type MessageStatus = "pending" | "answered" | "expired" | "orphaned";
export type SubscriptionStatus =
  | "queued"
  | "trial"
  | "active"
  | "trial_expired"
  | "lapsed"
  | "payment_failed"
  | "frozen";
export type OnboardingState =
  | "welcome"
  | "video1"
  | "video2"
  | "awaiting_name"
  | "cta_record"
  | "awaiting_first_reply"
  | "meta_explainer_pending"
  | "day1_active"
  | "day2_active"
  | "day2_conversion_pending"
  | "awaiting_survey"
  | "survey_yes"
  | "survey_later"
  | "survey_no"
  | "churn_followup_pending"
  | "done_paid"
  | "done_churned"
  | "done_skipped";
export type OnboardingTimerKind =
  | "nudge_2h"
  | "nudge_24h"
  | "meta_explainer"
  | "day2_conversion"
  | "survey"
  | "churn_followup"
  | "video_sequence_next";
export type StudentFlagKind =
  | "inactive"
  | "slump"
  | "plateau"
  | "ghosting"
  | "tutor_sla";
export type StudentFlagTier = "sliding" | "at_risk" | "dormant";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: number;
          tg_user_id: number;
          tg_chat_id: number;
          name: string | null;
          tg_username: string | null;
          display_handle: string | null;
          display_emoji: string | null;
          role: UserRole;
          is_admin: boolean;
          status: UserStatus;
          tz: string;
          created_at: string;
          role_changed_at: string | null;
          avatar_file_id: string | null;
          avatar_file_unique_id: string | null;
          avatar_fetched_at: string | null;
          referral_token: string | null;
          preferred_name: string | null;
        };
        Insert: {
          id?: number;
          tg_user_id: number;
          tg_chat_id: number;
          name?: string | null;
          tg_username?: string | null;
          display_handle?: string | null;
          display_emoji?: string | null;
          role?: UserRole;
          is_admin?: boolean;
          status?: UserStatus;
          tz?: string;
          created_at?: string;
          role_changed_at?: string | null;
          avatar_file_id?: string | null;
          avatar_file_unique_id?: string | null;
          avatar_fetched_at?: string | null;
          referral_token?: string | null;
          preferred_name?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      student_teachers: {
        Row: {
          student_id: number;
          teacher_id: number;
          created_at: string;
        };
        Insert: {
          student_id: number;
          teacher_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["student_teachers"]["Insert"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: number;
          student_id: number;
          direction: MessageDirection;
          teacher_id: number | null;
          kind: MessageKind;
          file_id: string | null;
          file_unique_id: string | null;
          text_content: string | null;
          duration: number;
          status: MessageStatus;
          claimed_by_teacher_id: number | null;
          claimed_at: string | null;
          answered_at: string | null;
          reply_to_id: number | null;
          tg_message_id_in_student_chat: number | null;
          media_library_id: number | null;
          transcript_text: string | null;
          transcript_tg_message_id: number | null;
          translation_text: string | null;
          translation_tg_message_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          student_id: number;
          direction: MessageDirection;
          teacher_id?: number | null;
          kind: MessageKind;
          file_id?: string | null;
          file_unique_id?: string | null;
          text_content?: string | null;
          duration: number;
          status: MessageStatus;
          claimed_by_teacher_id?: number | null;
          claimed_at?: string | null;
          answered_at?: string | null;
          reply_to_id?: number | null;
          tg_message_id_in_student_chat?: number | null;
          media_library_id?: number | null;
          transcript_text?: string | null;
          transcript_tg_message_id?: number | null;
          translation_text?: string | null;
          translation_tg_message_id?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: number;
          message_id: number;
          teacher_id: number;
          tg_chat_id: number;
          tg_notification_message_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          message_id: number;
          teacher_id: number;
          tg_chat_id: number;
          tg_notification_message_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      prompts: {
        Row: {
          id: number;
          teacher_id: number;
          student_id: number;
          student_message_id: number | null;
          tg_chat_id: number;
          tg_prompt_message_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          teacher_id: number;
          student_id: number;
          student_message_id?: number | null;
          tg_chat_id: number;
          tg_prompt_message_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prompts"]["Insert"]>;
        Relationships: [];
      };
      claims: {
        Row: {
          student_id: number;
          teacher_id: number;
          claimed_at: string;
          expires_at: string;
        };
        Insert: {
          student_id: number;
          teacher_id: number;
          claimed_at?: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["claims"]["Insert"]>;
        Relationships: [];
      };
      inbox_reads: {
        Row: {
          teacher_id: number;
          student_id: number;
          last_seen_at: string;
        };
        Insert: {
          teacher_id: number;
          student_id: number;
          last_seen_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inbox_reads"]["Insert"]>;
        Relationships: [];
      };
      quota_usage: {
        Row: {
          student_id: number;
          date: string;
          seconds_used: number;
        };
        Insert: {
          student_id: number;
          date: string;
          seconds_used?: number;
        };
        Update: Partial<Database["public"]["Tables"]["quota_usage"]["Insert"]>;
        Relationships: [];
      };
      teacher_invites: {
        Row: {
          id: number;
          token: string;
          created_by: number;
          created_at: string;
          consumed_at: string | null;
          consumed_by: number | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: number;
          token: string;
          created_by: number;
          created_at?: string;
          consumed_at?: string | null;
          consumed_by?: number | null;
          revoked_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["teacher_invites"]["Insert"]>;
        Relationships: [];
      };
      banned_tg_users: {
        Row: {
          tg_user_id: number;
          name_snapshot: string | null;
          banned_at: string;
          banned_by: number | null;
        };
        Insert: {
          tg_user_id: number;
          name_snapshot?: string | null;
          banned_at?: string;
          banned_by?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["banned_tg_users"]["Insert"]>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: number;
          created_at: string;
          actor_id: number | null;
          action: string;
          subject_type: string | null;
          subject_id: number | null;
          meta: Json;
        };
        Insert: {
          id?: number;
          created_at?: string;
          actor_id?: number | null;
          action: string;
          subject_type?: string | null;
          subject_id?: number | null;
          meta?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["audit_events"]["Insert"]>;
        Relationships: [];
      };
      feedback_claims: {
        Row: {
          user_id: number;
          admin_id: number;
          claimed_at: string;
          expires_at: string;
        };
        Insert: {
          user_id: number;
          admin_id: number;
          claimed_at?: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["feedback_claims"]["Insert"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          user_id: number;
          status: SubscriptionStatus;
          trial_started_at: string;
          trial_ends_at: string;
          current_period_starts_at: string | null;
          current_period_ends_at: string | null;
          next_renewal_at: string | null;
          freeze_days_used_in_period: number;
          freeze_period_started_at: string | null;
          frozen_until: string | null;
          response_window_start: string | null;
          response_window_end: string | null;
          response_window_tz: string;
          provider: string | null;
          provider_subscription_id: string | null;
          provider_customer_id: string | null;
          referred_by_user_id: number | null;
          last_motivation_key: string | null;
          last_motivation_shown_on: string | null;
          last_lockout_replied_at: string | null;
          last_renewal_reminder_sent_at: string | null;
          onboarding_state: OnboardingState;
          onboarding_state_entered_at: string;
          onboarding_first_msg_at: string | null;
          onboarding_first_reply_at: string | null;
          onboarding_last_active_at: string | null;
          onboarding_day1_limit_msg_sent_at: string | null;
          onboarding_last_pause_nudge_at: string | null;
          unassigned_ack_sent_at: string | null;
          transcripts_enabled: boolean;
          translation_enabled: boolean;
          acquisition_source_id: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: number;
          status?: SubscriptionStatus;
          trial_started_at?: string;
          trial_ends_at?: string;
          current_period_starts_at?: string | null;
          current_period_ends_at?: string | null;
          next_renewal_at?: string | null;
          freeze_days_used_in_period?: number;
          freeze_period_started_at?: string | null;
          frozen_until?: string | null;
          response_window_start?: string | null;
          response_window_end?: string | null;
          response_window_tz?: string;
          provider?: string | null;
          provider_subscription_id?: string | null;
          provider_customer_id?: string | null;
          referred_by_user_id?: number | null;
          last_motivation_key?: string | null;
          last_motivation_shown_on?: string | null;
          last_lockout_replied_at?: string | null;
          last_renewal_reminder_sent_at?: string | null;
          onboarding_state?: OnboardingState;
          onboarding_state_entered_at?: string;
          onboarding_first_msg_at?: string | null;
          onboarding_first_reply_at?: string | null;
          onboarding_last_active_at?: string | null;
          onboarding_day1_limit_msg_sent_at?: string | null;
          onboarding_last_pause_nudge_at?: string | null;
          unassigned_ack_sent_at?: string | null;
          transcripts_enabled?: boolean;
          translation_enabled?: boolean;
          acquisition_source_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
        Relationships: [];
      };
      acquisition_sources: {
        Row: {
          id: number;
          slug: string;
          label: string;
          created_by_user_id: number;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: number;
          slug: string;
          label: string;
          created_by_user_id: number;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["acquisition_sources"]["Insert"]>;
        Relationships: [];
      };
      user_tag_links: {
        Row: {
          user_id: number;
          tag_id: number;
          created_by_user_id: number;
          created_at: string;
        };
        Insert: {
          user_id: number;
          tag_id: number;
          created_by_user_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_tag_links"]["Insert"]>;
        Relationships: [];
      };
      onboarding_timers: {
        Row: {
          student_id: number;
          kind: OnboardingTimerKind;
          due_at: string;
          fired_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          meta: Json | null;
        };
        Insert: {
          student_id: number;
          kind: OnboardingTimerKind;
          due_at: string;
          fired_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          meta?: Json | null;
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_timers"]["Insert"]>;
        Relationships: [];
      };
      student_flags: {
        Row: {
          student_id: number;
          kind: StudentFlagKind;
          tier: StudentFlagTier | null;
          opened_at: string;
          last_evaluated_at: string;
          resolved_at: string | null;
          meta: Json;
        };
        Insert: {
          student_id: number;
          kind: StudentFlagKind;
          tier?: StudentFlagTier | null;
          opened_at?: string;
          last_evaluated_at?: string;
          resolved_at?: string | null;
          meta?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["student_flags"]["Insert"]>;
        Relationships: [];
      };
      scheduled_outbound: {
        Row: {
          id: number;
          student_id: number;
          teacher_id: number;
          kind: MessageKind;
          file_id: string;
          duration: number;
          original_message_id: number | null;
          tg_chat_id: number;
          deliver_at: string;
          status: "queued" | "sending" | "delivered" | "failed" | "cancelled";
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          student_id: number;
          teacher_id: number;
          kind: MessageKind;
          file_id: string;
          duration: number;
          original_message_id?: number | null;
          tg_chat_id: number;
          deliver_at: string;
          status?: "queued" | "sending" | "delivered" | "failed" | "cancelled";
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["scheduled_outbound"]["Insert"]>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_by: number | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_by?: number | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
        Relationships: [];
      };
      feedback_messages: {
        Row: {
          id: number;
          user_id: number;
          direction: "in" | "out";
          author_id: number | null;
          text_content: string;
          status: "sent" | "read";
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: number;
          direction: "in" | "out";
          author_id?: number | null;
          text_content: string;
          status?: "sent" | "read";
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["feedback_messages"]["Insert"]>;
        Relationships: [];
      };
      media_library: {
        Row: {
          id: number;
          kind: MediaKind;
          uploaded_by_user_id: number;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          title: string | null;
          description: string | null;
          bytes: number;
          duration_seconds: number | null;
          width: number | null;
          height: number | null;
          tg_file_id: string | null;
          tg_file_unique_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          kind: MediaKind;
          uploaded_by_user_id: number;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          title?: string | null;
          description?: string | null;
          bytes: number;
          duration_seconds?: number | null;
          width?: number | null;
          height?: number | null;
          tg_file_id?: string | null;
          tg_file_unique_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_library"]["Insert"]>;
        Relationships: [];
      };
      media_tags: {
        Row: {
          id: number;
          name: string;
          slug: string;
          created_by_user_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          slug: string;
          created_by_user_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_tags"]["Insert"]>;
        Relationships: [];
      };
      media_library_tag_links: {
        Row: {
          media_library_id: number;
          tag_id: number;
          created_by_user_id: number;
          created_at: string;
        };
        Insert: {
          media_library_id: number;
          tag_id: number;
          created_by_user_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_library_tag_links"]["Insert"]>;
        Relationships: [];
      };
      onboarding_videos: {
        Row: {
          id: number;
          step: OnboardingVideoStep;
          position: number;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          bytes: number;
          duration_seconds: number | null;
          tg_file_id: string | null;
          tg_file_unique_id: string | null;
          uploaded_by_user_id: number;
          uploaded_at: string;
        };
        Insert: {
          id?: number;
          step: OnboardingVideoStep;
          position?: number;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          bytes: number;
          duration_seconds?: number | null;
          tg_file_id?: string | null;
          tg_file_unique_id?: string | null;
          uploaded_by_user_id: number;
          uploaded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_videos"]["Insert"]>;
        Relationships: [];
      };
      tutor_work_events: {
        Row: {
          id: number;
          tutor_id: number;
          kind: "active" | "playback" | "recording";
          started_at: string;
          ended_at: string;
          ref_id: number | null;
          source: string;
          duration_s: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          tutor_id: number;
          kind: "active" | "playback" | "recording";
          started_at: string;
          ended_at: string;
          ref_id?: number | null;
          source: string;
          duration_s?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_work_events"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_app_user: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["users"]["Row"];
      };
      delete_user_cascade: {
        Args: { target_id: number };
        Returns: void;
      };
      swap_onboarding_video_positions: {
        Args: { id_a: number; id_b: number };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type StudentFlagRow = Database["public"]["Tables"]["student_flags"]["Row"];
