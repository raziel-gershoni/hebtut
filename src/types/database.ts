// Hand-written to mirror `supabase gen types typescript --linked --schema public`.
// Re-generate with `pnpm db:types` once the Supabase project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "pending" | "student" | "teacher" | "admin";
export type UserStatus = "active" | "paused";
export type MessageDirection = "in" | "out";
export type MessageKind = "voice" | "video_note";
export type MessageStatus = "pending" | "claimed" | "answered" | "expired" | "orphaned";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: number;
          tg_user_id: number;
          tg_chat_id: number;
          name: string | null;
          role: UserRole;
          status: UserStatus;
          tz: string;
          created_at: string;
          role_changed_at: string | null;
        };
        Insert: {
          id?: number;
          tg_user_id: number;
          tg_chat_id: number;
          name?: string | null;
          role?: UserRole;
          status?: UserStatus;
          tz?: string;
          created_at?: string;
          role_changed_at?: string | null;
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
          student_message_id: number;
          tg_chat_id: number;
          tg_prompt_message_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          teacher_id: number;
          student_message_id: number;
          tg_chat_id: number;
          tg_prompt_message_id: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prompts"]["Insert"]>;
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
    };
    Views: Record<string, never>;
    Functions: {
      current_app_user: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["users"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
