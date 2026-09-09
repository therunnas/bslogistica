export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      clients: {
        Row: {
          contact_name: string | null;
          created_at: string;
          doc: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["record_status"];
          updated_at: string;
        };
        Insert: {
          contact_name?: string | null;
          created_at?: string;
          doc?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Update: {
          contact_name?: string | null;
          created_at?: string;
          doc?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      contracts: {
        Row: {
          client_id: string;
          created_at: string;
          daily_rate: number;
          id: string;
          name: string;
          ot_factor: number;
          ot_tolerance_min: number;
          shift_hours: number;
          status: Database["public"]["Enums"]["record_status"];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          daily_rate?: number;
          id?: string;
          name: string;
          ot_factor?: number;
          ot_tolerance_min?: number;
          shift_hours?: number;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          daily_rate?: number;
          id?: string;
          name?: string;
          ot_factor?: number;
          ot_tolerance_min?: number;
          shift_hours?: number;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          created_at: string;
          daily_cost: number;
          doc: string | null;
          id: string;
          name: string;
          phone: string | null;
          role: string | null;
          status: Database["public"]["Enums"]["record_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          daily_cost?: number;
          doc?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          role?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          daily_cost?: number;
          doc?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          role?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      invoice_items: {
        Row: {
          amount: number;
          created_at: string;
          description: string;
          id: string;
          invoice_id: string;
          operation_id: string | null;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          description: string;
          id?: string;
          invoice_id: string;
          operation_id?: string | null;
          quantity?: number;
          unit_price?: number;
        };
        Update: {
          amount?: number;
          created_at?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          operation_id?: string | null;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          client_id: string;
          created_at: string;
          id: string;
          notes: string | null;
          period_end: string;
          period_start: string;
          status: Database["public"]["Enums"]["invoice_status"];
          total_amount: number;
          total_cost: number;
          total_dailies: number;
          total_overtime: number;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          period_end: string;
          period_start: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          total_amount?: number;
          total_cost?: number;
          total_dailies?: number;
          total_overtime?: number;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          period_end?: string;
          period_start?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          total_amount?: number;
          total_cost?: number;
          total_dailies?: number;
          total_overtime?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      operation_team: {
        Row: {
          active: boolean;
          created_at: string;
          employee_id: string;
          id: string;
          operation_id: string;
          shift_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          employee_id: string;
          id?: string;
          operation_id: string;
          shift_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          employee_id?: string;
          id?: string;
          operation_id?: string;
          shift_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "operation_team_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_team_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_team_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
        ];
      };
      operations: {
        Row: {
          agreed_amount: number | null;
          client_id: string;
          contract_id: string | null;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          operation_date: string | null;
          site: string | null;
          status: Database["public"]["Enums"]["record_status"];
          type: Database["public"]["Enums"]["operation_type"];
          updated_at: string;
        };
        Insert: {
          agreed_amount?: number | null;
          client_id: string;
          contract_id?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          operation_date?: string | null;
          site?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          type?: Database["public"]["Enums"]["operation_type"];
          updated_at?: string;
        };
        Update: {
          agreed_amount?: number | null;
          client_id?: string;
          contract_id?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          operation_date?: string | null;
          site?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          type?: Database["public"]["Enums"]["operation_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operations_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shifts: {
        Row: {
          break_minutes: number;
          created_at: string;
          crosses_midnight: boolean;
          end_time: string;
          id: string;
          name: string;
          operation_id: string;
          start_time: string;
          status: Database["public"]["Enums"]["record_status"];
          updated_at: string;
        };
        Insert: {
          break_minutes?: number;
          created_at?: string;
          crosses_midnight?: boolean;
          end_time: string;
          id?: string;
          name: string;
          operation_id: string;
          start_time: string;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Update: {
          break_minutes?: number;
          created_at?: string;
          crosses_midnight?: boolean;
          end_time?: string;
          id?: string;
          name?: string;
          operation_id?: string;
          start_time?: string;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
        ];
      };
      timesheet_entries: {
        Row: {
          billed_amount: number;
          break_minutes: number;
          check_in: string | null;
          check_out: string | null;
          cost_amount: number;
          created_at: string;
          daily_cost_snapshot: number;
          daily_rate_snapshot: number;
          employee_id: string;
          id: string;
          invoice_id: string | null;
          notes: string | null;
          operation_id: string;
          ot_hour_rate_snapshot: number;
          overtime_minutes: number;
          status: Database["public"]["Enums"]["attendance_status"];
          timesheet_id: string;
          updated_at: string;
          work_date: string;
          worked_minutes: number;
        };
        Insert: {
          billed_amount?: number;
          break_minutes?: number;
          check_in?: string | null;
          check_out?: string | null;
          cost_amount?: number;
          created_at?: string;
          daily_cost_snapshot?: number;
          daily_rate_snapshot?: number;
          employee_id: string;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          operation_id: string;
          ot_hour_rate_snapshot?: number;
          overtime_minutes?: number;
          status?: Database["public"]["Enums"]["attendance_status"];
          timesheet_id: string;
          updated_at?: string;
          work_date: string;
          worked_minutes?: number;
        };
        Update: {
          billed_amount?: number;
          break_minutes?: number;
          check_in?: string | null;
          check_out?: string | null;
          cost_amount?: number;
          created_at?: string;
          daily_cost_snapshot?: number;
          daily_rate_snapshot?: number;
          employee_id?: string;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          operation_id?: string;
          ot_hour_rate_snapshot?: number;
          overtime_minutes?: number;
          status?: Database["public"]["Enums"]["attendance_status"];
          timesheet_id?: string;
          updated_at?: string;
          work_date?: string;
          worked_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timesheet_entries_invoice_fk";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timesheet_entries_timesheet_id_fkey";
            columns: ["timesheet_id"];
            isOneToOne: false;
            referencedRelation: "timesheets";
            referencedColumns: ["id"];
          },
        ];
      };
      timesheets: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          operation_id: string;
          shift_id: string | null;
          status: Database["public"]["Enums"]["timesheet_status"];
          updated_at: string;
          work_date: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          operation_id: string;
          shift_id?: string | null;
          status?: Database["public"]["Enums"]["timesheet_status"];
          updated_at?: string;
          work_date: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          operation_id?: string;
          shift_id?: string | null;
          status?: Database["public"]["Enums"]["timesheet_status"];
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timesheets_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      gerar_fatura: {
        Args: {
          _client_id: string;
          _period_start: string;
          _period_end: string;
        };
        Returns: Database["public"]["Tables"]["invoices"]["Row"];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_staff: { Args: never; Returns: boolean };
    };
    Enums: {
      app_role: "admin" | "operacional";
      attendance_status: "present" | "absent" | "replacement";
      invoice_status: "draft" | "closed" | "issued";
      operation_type: "fixed" | "spot";
      record_status: "active" | "inactive";
      timesheet_status: "open" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operacional"],
      attendance_status: ["present", "absent", "replacement"],
      invoice_status: ["draft", "closed", "issued"],
      operation_type: ["fixed", "spot"],
      record_status: ["active", "inactive"],
      timesheet_status: ["open", "closed"],
    },
  },
} as const;
