// Hand-written to mirror `supabase gen types typescript --linked --schema public`.
// Re-generate with `pnpm db:types` once the Supabase project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "pending" | "student" | "teacher";
export type UserStatus = "active" | "suspended";
export type MessageDirection = "in" | "out";
export type MessageKind = "voice" | "video_note";
export type MessageStatus = "pending" | "answered" | "expired" | "orphaned";

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
          file_id: string;
          file_unique_id: string | null;
          duration: number;
          status: MessageStatus;
          claimed_by_teacher_id: number | null;
          claimed_at: string | null;
          answered_at: string | null;
          reply_to_id: number | null;
          tg_message_id_in_student_chat: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          student_id: number;
          direction: MessageDirection;
          teacher_id?: number | null;
          kind: MessageKind;
          file_id: string;
          file_unique_id?: string | null;
          duration: number;
          status: MessageStatus;
          claimed_by_teacher_id?: number | null;
          claimed_at?: string | null;
          answered_at?: string | null;
          reply_to_id?: number | null;
          tg_message_id_in_student_chat?: number | null;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
