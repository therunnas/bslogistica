export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      billing_additionals: {
        Row: {
          amount: number;
          billing_period_end: string | null;
          billing_period_start: string | null;
          cancel_reason: string | null;
          canceled_at: string | null;
          canceled_by: string | null;
          client_id: string;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          invoice_id: string | null;
          operation_id: string | null;
          period_end: string;
          period_start: string;
          reference: string | null;
        };
        Insert: {
          amount: number;
          billing_period_end?: string | null;
          billing_period_start?: string | null;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          canceled_by?: string | null;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          invoice_id?: string | null;
          operation_id?: string | null;
          period_end: string;
          period_start: string;
          reference?: string | null;
        };
        Update: {
          amount?: number;
          billing_period_end?: string | null;
          billing_period_start?: string | null;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          canceled_by?: string | null;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          invoice_id?: string | null;
          operation_id?: string | null;
          period_end?: string;
          period_start?: string;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_additionals_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_additionals_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_additionals_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
        ];
      };
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
      contract_terms: {
        Row: {
          active: boolean;
          closing_period: string;
          contract_id: string;
          created_at: string;
          created_by: string | null;
          daily_rate: number;
          holiday_pay_factor: number | null;
          id: string;
          origin: string;
          ot_factor: number;
          ot_rounding_mode: string;
          ot_tolerance_min: number;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          saturday_shift_hours: number | null;
          shift_hours: number;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          active?: boolean;
          closing_period?: string;
          contract_id: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate: number;
          holiday_pay_factor?: number | null;
          id?: string;
          origin: string;
          ot_factor: number;
          ot_rounding_mode?: string;
          ot_tolerance_min: number;
          reason: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          saturday_shift_hours?: number | null;
          shift_hours: number;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          active?: boolean;
          closing_period?: string;
          contract_id?: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate?: number;
          holiday_pay_factor?: number | null;
          id?: string;
          origin?: string;
          ot_factor?: number;
          ot_rounding_mode?: string;
          ot_tolerance_min?: number;
          reason?: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          saturday_shift_hours?: number | null;
          shift_hours?: number;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contract_terms_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_terms_replaced_by_fkey";
            columns: ["replaced_by"];
            isOneToOne: false;
            referencedRelation: "contract_terms";
            referencedColumns: ["id"];
          },
        ];
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
      employee_cost_terms: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          daily_cost: number;
          employee_id: string;
          id: string;
          origin: string;
          ot_hourly_cost: number | null;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          daily_cost: number;
          employee_id: string;
          id?: string;
          origin: string;
          ot_hourly_cost?: number | null;
          reason: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          daily_cost?: number;
          employee_id?: string;
          id?: string;
          origin?: string;
          ot_hourly_cost?: number | null;
          reason?: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employee_cost_terms_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_cost_terms_replaced_by_fkey";
            columns: ["replaced_by"];
            isOneToOne: false;
            referencedRelation: "employee_cost_terms";
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
          job_function_id: string | null;
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
          job_function_id?: string | null;
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
          job_function_id?: string | null;
          name?: string;
          phone?: string | null;
          role?: string | null;
          status?: Database["public"]["Enums"]["record_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      financial_engine_settings: {
        Row: {
          ativada_em: string | null;
          changed_at: string;
          changed_by: string | null;
          id: boolean;
          reason: string | null;
          vigencia_ativa: boolean;
        };
        Insert: {
          ativada_em?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          id?: boolean;
          reason?: string | null;
          vigencia_ativa?: boolean;
        };
        Update: {
          ativada_em?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          id?: boolean;
          reason?: string | null;
          vigencia_ativa?: boolean;
        };
        Relationships: [];
      };
      financial_holidays: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          holiday_date: string;
          id: string;
          name: string;
          reason: string;
          retire_reason: string | null;
          retired_at: string | null;
          retired_by: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          holiday_date: string;
          id?: string;
          name: string;
          reason: string;
          retire_reason?: string | null;
          retired_at?: string | null;
          retired_by?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          holiday_date?: string;
          id?: string;
          name?: string;
          reason?: string;
          retire_reason?: string | null;
          retired_at?: string | null;
          retired_by?: string | null;
        };
        Relationships: [];
      };
      financial_terms_audit: {
        Row: {
          action: string;
          actor_id: string;
          actor_session_id: string | null;
          entity_id: string;
          entity_kind: string;
          id: string;
          new: Json | null;
          occurred_at: string;
          previous: Json | null;
          reason: string;
          term_id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          actor_session_id?: string | null;
          entity_id: string;
          entity_kind: string;
          id?: string;
          new?: Json | null;
          occurred_at?: string;
          previous?: Json | null;
          reason: string;
          term_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          actor_session_id?: string | null;
          entity_id?: string;
          entity_kind?: string;
          id?: string;
          new?: Json | null;
          occurred_at?: string;
          previous?: Json | null;
          reason?: string;
          term_id?: string;
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
          kind: string | null;
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
          kind?: string | null;
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
          kind?: string | null;
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
      contract_employee_rates: {
        Row: {
          active: boolean;
          contract_id: string;
          created_at: string;
          created_by: string | null;
          daily_rate: number;
          employee_id: string;
          id: string;
          origin: string;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          active?: boolean;
          contract_id: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate: number;
          employee_id: string;
          id?: string;
          origin: string;
          reason: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          active?: boolean;
          contract_id?: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate?: number;
          employee_id?: string;
          id?: string;
          origin?: string;
          reason?: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [];
      };
      contract_rate_terms: {
        Row: {
          active: boolean;
          contract_id: string;
          created_at: string;
          created_by: string | null;
          daily_rate: number;
          id: string;
          job_function_id: string;
          origin: string;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          shift_period: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          active?: boolean;
          contract_id: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate: number;
          id?: string;
          job_function_id: string;
          origin: string;
          reason: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          shift_period: string;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          active?: boolean;
          contract_id?: string;
          created_at?: string;
          created_by?: string | null;
          daily_rate?: number;
          id?: string;
          job_function_id?: string;
          origin?: string;
          reason?: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          shift_period?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [];
      };
      job_functions: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          name_key: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      pricing_settings: {
        Row: {
          ativada_em: string | null;
          changed_at: string;
          changed_by: string | null;
          id: boolean;
          reason: string | null;
          tarifas_por_funcao: boolean;
        };
        Insert: {
          ativada_em?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          id?: boolean;
          reason?: string | null;
          tarifas_por_funcao?: boolean;
        };
        Update: {
          ativada_em?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          id?: boolean;
          reason?: string | null;
          tarifas_por_funcao?: boolean;
        };
        Relationships: [];
      };
      operation_team: {
        Row: {
          active: boolean;
          created_at: string;
          employee_id: string;
          id: string;
          job_function_id: string | null;
          operation_id: string;
          shift_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          employee_id: string;
          id?: string;
          job_function_id?: string | null;
          operation_id: string;
          shift_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          employee_id?: string;
          id?: string;
          job_function_id?: string | null;
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
      operation_terms: {
        Row: {
          active: boolean;
          agreed_amount: number;
          created_at: string;
          created_by: string | null;
          id: string;
          operation_id: string;
          origin: string;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          active?: boolean;
          agreed_amount: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          operation_id: string;
          origin: string;
          reason: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          active?: boolean;
          agreed_amount?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          operation_id?: string;
          origin?: string;
          reason?: string;
          replaced_by?: string | null;
          retired_at?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "operation_terms_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operation_terms_replaced_by_fkey";
            columns: ["replaced_by"];
            isOneToOne: false;
            referencedRelation: "operation_terms";
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
          {
            foreignKeyName: "operations_contrato_do_cliente_fkey";
            columns: ["contract_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id", "client_id"];
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
          shift_period: string | null;
          shift_period_set_at: string | null;
          shift_period_set_by: string | null;
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
          shift_period?: string | null;
          shift_period_set_at?: string | null;
          shift_period_set_by?: string | null;
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
          shift_period?: string | null;
          shift_period_set_at?: string | null;
          shift_period_set_by?: string | null;
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
          additional_amount: number;
          billed_amount: number;
          billed_base_amount: number | null;
          billed_overtime_amount: number | null;
          billed_overtime_minutes: number | null;
          billed_special_amount: number | null;
          break_minutes: number;
          calc_version: number | null;
          check_in: string | null;
          check_out: string | null;
          contract_employee_rate_id: string | null;
          contract_rate_terms_id: string | null;
          contract_terms_id: string | null;
          cost_amount: number;
          created_at: string;
          daily_cost_snapshot: number;
          daily_rate_snapshot: number;
          day_kind_snapshot: string | null;
          employee_cost_terms_id: string | null;
          employee_id: string;
          id: string;
          invoice_id: string | null;
          job_function_id_snapshot: string | null;
          job_function_source: string | null;
          notes: string | null;
          operation_id: string;
          operation_terms_id: string | null;
          ot_factor_snapshot: number | null;
          ot_hour_rate_snapshot: number;
          ot_hourly_cost_snapshot: number | null;
          ot_tolerance_snapshot: number | null;
          overtime_minutes: number;
          planned_minutes_snapshot: number | null;
          price_source: string | null;
          shift_hours_snapshot: number | null;
          shift_period_snapshot: string | null;
          status: Database["public"]["Enums"]["attendance_status"];
          terms_origin: string | null;
          timesheet_id: string;
          updated_at: string;
          work_date: string;
          worked_minutes: number;
        };
        Insert: {
          additional_amount?: number;
          billed_amount?: number;
          billed_base_amount?: number | null;
          billed_overtime_amount?: number | null;
          billed_overtime_minutes?: number | null;
          billed_special_amount?: number | null;
          break_minutes?: number;
          calc_version?: number | null;
          check_in?: string | null;
          check_out?: string | null;
          contract_employee_rate_id?: string | null;
          contract_rate_terms_id?: string | null;
          contract_terms_id?: string | null;
          cost_amount?: number;
          created_at?: string;
          daily_cost_snapshot?: number;
          daily_rate_snapshot?: number;
          day_kind_snapshot?: string | null;
          employee_cost_terms_id?: string | null;
          employee_id: string;
          id?: string;
          invoice_id?: string | null;
          job_function_id_snapshot?: string | null;
          job_function_source?: string | null;
          notes?: string | null;
          operation_id: string;
          operation_terms_id?: string | null;
          ot_factor_snapshot?: number | null;
          ot_hour_rate_snapshot?: number;
          ot_hourly_cost_snapshot?: number | null;
          ot_tolerance_snapshot?: number | null;
          overtime_minutes?: number;
          planned_minutes_snapshot?: number | null;
          price_source?: string | null;
          shift_hours_snapshot?: number | null;
          shift_period_snapshot?: string | null;
          status?: Database["public"]["Enums"]["attendance_status"];
          terms_origin?: string | null;
          timesheet_id: string;
          updated_at?: string;
          work_date: string;
          worked_minutes?: number;
        };
        Update: {
          additional_amount?: number;
          billed_amount?: number;
          billed_base_amount?: number | null;
          billed_overtime_amount?: number | null;
          billed_overtime_minutes?: number | null;
          billed_special_amount?: number | null;
          break_minutes?: number;
          calc_version?: number | null;
          check_in?: string | null;
          check_out?: string | null;
          contract_employee_rate_id?: string | null;
          contract_rate_terms_id?: string | null;
          contract_terms_id?: string | null;
          cost_amount?: number;
          created_at?: string;
          daily_cost_snapshot?: number;
          daily_rate_snapshot?: number;
          day_kind_snapshot?: string | null;
          employee_cost_terms_id?: string | null;
          employee_id?: string;
          id?: string;
          invoice_id?: string | null;
          job_function_id_snapshot?: string | null;
          job_function_source?: string | null;
          notes?: string | null;
          operation_id?: string;
          operation_terms_id?: string | null;
          ot_factor_snapshot?: number | null;
          ot_hour_rate_snapshot?: number;
          ot_hourly_cost_snapshot?: number | null;
          ot_tolerance_snapshot?: number | null;
          overtime_minutes?: number;
          planned_minutes_snapshot?: number | null;
          price_source?: string | null;
          shift_hours_snapshot?: number | null;
          shift_period_snapshot?: string | null;
          status?: Database["public"]["Enums"]["attendance_status"];
          terms_origin?: string | null;
          timesheet_id?: string;
          updated_at?: string;
          work_date?: string;
          worked_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_contract_terms_id_fkey";
            columns: ["contract_terms_id"];
            isOneToOne: false;
            referencedRelation: "contract_terms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timesheet_entries_employee_cost_terms_id_fkey";
            columns: ["employee_cost_terms_id"];
            isOneToOne: false;
            referencedRelation: "employee_cost_terms";
            referencedColumns: ["id"];
          },
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
            foreignKeyName: "timesheet_entries_operation_terms_id_fkey";
            columns: ["operation_terms_id"];
            isOneToOne: false;
            referencedRelation: "operation_terms";
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
      user_operation_access: {
        Row: {
          created_at: string;
          created_by: string | null;
          operation_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          operation_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          operation_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_operation_access_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "operations";
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
      ajustes_de_arredondamento_acumulado: {
        Args: { p_apontamentos?: string[]; p_client_id: string; p_fim: string; p_inicio: string };
        Returns: {
          ajuste: number;
          colaborador: string;
          employee_id: string;
          minutos_arredondados: number;
          minutos_brutos: number;
          valor_arredondado: number;
          valor_bruto: number;
          valor_hora: number;
        }[];
      };
      alterar_situacao_funcao: {
        Args: { p_active: boolean; p_id: string };
        Returns: undefined;
      };
      alterar_resolucao_tarifas: {
        Args: { p_aceitar_contratos_sem_tarifa?: boolean; p_ativar: boolean; p_reason: string };
        Returns: Json;
      };
      alterar_motor_vigencia: {
        Args: {
          p_aceitar_pendencias?: boolean;
          p_ativar: boolean;
          p_reason: string;
        };
        Returns: Json;
      };
      apontamento_faturado: {
        Args: { p_employee_id: string; p_timesheet_id: string };
        Returns: boolean;
      };
      aposentar_condicao_contrato: {
        Args: { p_reason: string; p_term_id: string };
        Returns: undefined;
      };
      aposentar_custo_colaborador: {
        Args: { p_reason: string; p_term_id: string };
        Returns: undefined;
      };
      aposentar_feriado: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      aposentar_valor_acordado_operacao: {
        Args: { p_reason: string; p_term_id: string };
        Returns: undefined;
      };
      arredondar_minutos_extras: { Args: { p_minutos: number }; Returns: number };
      cancelar_adicional: {
        Args: { p_additional_id: string; p_reason: string };
        Returns: undefined;
      };
      competencia_de_cobranca: {
        Args: { p_client_id: string; p_data: string };
        Returns: {
          fim: string;
          frequencia: string;
          inicio: string;
        }[];
      };
      componentes_do_lancamento: {
        Args: {
          p_adicional: number;
          p_base: number;
          p_calc_version: number;
          p_cobrado: number;
          p_diaria: number;
          p_especial: number;
          p_extra: number;
          p_status: string;
        };
        Returns: Record<string, unknown>;
      };
      aposentar_diaria_individual: {
        Args: { p_rate_id: string; p_reason: string };
        Returns: undefined;
      };
      aposentar_tarifa_contrato: {
        Args: { p_rate_id: string; p_reason: string };
        Returns: undefined;
      };
      condicao_contrato_na_data: {
        Args: { p_contract_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          closing_period: string;
          contract_id: string;
          created_at: string;
          created_by: string | null;
          daily_rate: number;
          holiday_pay_factor: number | null;
          id: string;
          origin: string;
          ot_factor: number;
          ot_rounding_mode: string;
          ot_tolerance_min: number;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          saturday_shift_hours: number | null;
          shift_hours: number;
          valid_from: string;
          valid_to: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "contract_terms";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      condicoes_auditar: {
        Args: {
          p_action: string;
          p_entity: string;
          p_kind: string;
          p_new: Json;
          p_previous: Json;
          p_reason: string;
          p_term: string;
        };
        Returns: undefined;
      };
      condicoes_encerrar_colaborador_interno: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      condicoes_encerrar_contrato_interno: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      condicoes_encerrar_operacao_interno: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      condicoes_exigir_admin: { Args: never; Returns: undefined };
      condicoes_validar_hora_extra: { Args: { p_valor: number }; Returns: number };
      condicoes_validar_motivo: { Args: { p_reason: string }; Returns: string };
      condicoes_validar_parametros_de_horas: {
        Args: { p_feriado: number; p_modo: string; p_sabado: number; p_shift_hours: number };
        Returns: undefined;
      };
      conta_ativa: { Args: { p_user_id: string }; Returns: boolean };
      corrigir_condicao_contrato: {
        Args: {
          p_daily_rate: number;
          p_holiday_pay_factor?: number;
          p_ot_factor: number;
          p_ot_rounding_mode?: string;
          p_ot_tolerance_min: number;
          p_reason: string;
          p_saturday_shift_hours?: number;
          p_shift_hours: number;
          p_term_id: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      corrigir_custo_colaborador: {
        Args: {
          p_daily_cost: number;
          p_ot_hourly_cost?: number;
          p_reason: string;
          p_term_id: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      corrigir_valor_acordado_operacao: {
        Args: {
          p_agreed_amount: number;
          p_reason: string;
          p_term_id: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      criar_colaborador_com_vigencia: {
        Args: {
          p_daily_cost: number;
          p_doc: string;
          p_name: string;
          p_ot_hourly_cost?: number;
          p_phone: string;
          p_reason: string;
          p_role: string;
          p_status: string;
          p_valid_from: string;
        };
        Returns: string;
      };
      criar_contrato_com_vigencia: {
        Args: {
          p_client_id: string;
          p_closing_period?: string;
          p_daily_rate: number;
          p_holiday_pay_factor?: number;
          p_name: string;
          p_ot_factor: number;
          p_ot_rounding_mode?: string;
          p_ot_tolerance_min: number;
          p_reason: string;
          p_saturday_shift_hours?: number;
          p_shift_hours: number;
          p_status: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      corrigir_snapshots_do_apontamento: {
        Args: {
          p_atualizar_periodo: boolean;
          p_entry_id: string;
          p_job_function_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      corrigir_diaria_individual: {
        Args: {
          p_daily_rate: number;
          p_rate_id: string;
          p_reason: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      corrigir_tarifa_contrato: {
        Args: {
          p_daily_rate: number;
          p_rate_id: string;
          p_reason: string;
          p_valid_from: string;
          p_valid_to: string;
        };
        Returns: string;
      };
      definir_bonus_do_apontamento: {
        Args: {
          p_amount: number;
          p_entry_id: string;
          p_reason: string;
          p_substituir?: boolean;
        };
        Returns: Json;
      };
      diaria_individual_na_data: {
        Args: { p_contract_id: string; p_data: string; p_employee_id: string };
        Returns: {
          daily_rate: number;
          id: string;
          valid_from: string;
          valid_to: string | null;
        }[];
      };
      encerrar_diaria_individual: {
        Args: { p_rate_id: string; p_reason: string; p_valid_to: string };
        Returns: undefined;
      };
      encerrar_tarifa_contrato: {
        Args: { p_rate_id: string; p_reason: string; p_valid_to: string };
        Returns: undefined;
      };
      criar_funcao: {
        Args: { p_code?: string; p_name: string };
        Returns: string;
      };
      criar_operacao_com_vigencia: {
        Args: {
          p_agreed_amount: number;
          p_client_id: string;
          p_name: string;
          p_notes: string;
          p_operation_date: string;
          p_reason: string;
          p_site: string;
          p_status: string;
          p_type: string;
          p_valid_from: string;
        };
        Returns: string;
      };
      custo_colaborador_na_data: {
        Args: { p_employee_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          daily_cost: number;
          employee_id: string;
          id: string;
          origin: string;
          ot_hourly_cost: number | null;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "employee_cost_terms";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      divergencias_implantacao_vigencias: {
        Args: never;
        Returns: {
          campos: string[];
          id: string;
          nome: string;
          tipo: string;
        }[];
      };
      encerrar_condicao_contrato: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      encerrar_custo_colaborador: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      encerrar_valor_acordado_operacao: {
        Args: { p_reason: string; p_term_id: string; p_valid_to: string };
        Returns: undefined;
      };
      estado_motor_vigencia: { Args: never; Returns: Json };
      exigir_condicao_contrato_na_data: {
        Args: { p_contract_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          contract_id: string;
          created_at: string;
          created_by: string | null;
          daily_rate: number;
          holiday_pay_factor: number | null;
          id: string;
          origin: string;
          ot_factor: number;
          ot_rounding_mode: string;
          ot_tolerance_min: number;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          saturday_shift_hours: number | null;
          shift_hours: number;
          valid_from: string;
          valid_to: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "contract_terms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      exigir_custo_colaborador_na_data: {
        Args: { p_employee_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          daily_cost: number;
          employee_id: string;
          id: string;
          origin: string;
          ot_hourly_cost: number | null;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "employee_cost_terms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      exigir_valor_acordado_operacao_na_data: {
        Args: { p_operation_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          agreed_amount: number;
          created_at: string;
          created_by: string | null;
          id: string;
          operation_id: string;
          origin: string;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "operation_terms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      gerar_fatura: {
        Args: { _client_id: string; _period_end: string; _period_start: string };
        Returns: {
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
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      identidade_atual_utilizavel: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      listar_apontamentos_do_operador: {
        Args: {
          p_operation_id: string;
          p_shift_id: string;
          p_work_date: string;
        };
        Returns: {
          break_minutes: number;
          check_in: string;
          check_out: string;
          employee_id: string;
          faturado: boolean;
          folha_status: Database["public"]["Enums"]["timesheet_status"];
          notes: string;
          shift_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
          timesheet_id: string;
          work_date: string;
        }[];
      };
      listar_equipe_do_operador: {
        Args: { p_operation_id: string; p_shift_id: string };
        Returns: {
          active: boolean;
          employee_id: string;
          employee_name: string;
          employee_role: string;
        }[];
      };
      listar_operacoes_do_operador: {
        Args: never;
        Returns: {
          cliente_nome: string;
          id: string;
          name: string;
          operation_date: string;
          site: string;
          status: Database["public"]["Enums"]["record_status"];
          type: Database["public"]["Enums"]["operation_type"];
        }[];
      };
      listar_turnos_do_operador: {
        Args: { p_operation_id: string };
        Returns: {
          break_minutes: number;
          crosses_midnight: boolean;
          end_time: string;
          id: string;
          name: string;
          start_time: string;
        }[];
      };
      mfa_bloqueia_excecao_aal1: { Args: never; Returns: boolean };
      motor_ativo: { Args: never; Returns: boolean };
      motor_custo_do_dia: {
        Args: { p_employee_id: string; p_work_date: string };
        Returns: Record<string, unknown>;
      };
      motor_fonte_do_dia: {
        Args: { p_operation_id: string; p_work_date: string };
        Returns: Record<string, unknown>;
      };
      motor_minutos_previstos: { Args: { p_shift_id: string }; Returns: number };
      motor_pendencias: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
          tipo: string;
        }[];
      };
      motor_sincronizar_colunas_interno: { Args: never; Returns: Json };
      motor_tipo_do_dia: { Args: { p_data: string }; Returns: string };
      nucleo_arredondar_centavos: {
        Args: { p_denominador: number; p_numerador: number };
        Returns: number;
      };
      nucleo_arredondar_he_diaria: { Args: { p_minutos: number }; Returns: number };
      nucleo_componentes_legado_010: {
        Args: {
          p_custo: number;
          p_diaria: number;
          p_entrada: string;
          p_fator: number;
          p_intervalo: number;
          p_jornada: number;
          p_previsto: number;
          p_saida: string;
          p_status: string;
          p_tolerancia: number;
        };
        Returns: Record<string, unknown>;
      };
      nucleo_componentes_v2: {
        Args: {
          p_adicional: number;
          p_arredondamento_especial: string;
          p_custo_diario: number;
          p_custo_hora_he: number;
          p_diaria: number;
          p_entrada: string;
          p_fator_especial: number;
          p_fator_he: number;
          p_intervalo: number;
          p_modo_he: string;
          p_saida: string;
          p_status: string;
          p_tipo_dia: string;
          p_tolerancia: number;
        };
        Returns: Record<string, unknown>;
      };
      nucleo_minutos_previstos: {
        Args: { p_cruza: boolean; p_fim: string; p_inicio: string; p_intervalo: number };
        Returns: number;
      };
      nucleo_minutos_trabalhados: {
        Args: { p_entrada: string; p_intervalo: number; p_saida: string };
        Returns: number;
      };
      operador_autorizado: {
        Args: { p_operation_id: string };
        Returns: boolean;
      };
      operador_elegivel_aal1: { Args: never; Returns: boolean };
      operador_elegivel_operacional: { Args: never; Returns: boolean };
      pendencias_implantacao_vigencias: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
          tipo: string;
        }[];
      };
      provision_bslog_user: {
        Args: { _email: string; _metadata?: Json; _user_id: string };
        Returns: undefined;
      };
      registrar_diaria_individual: {
        Args: {
          p_contract_id: string;
          p_daily_rate: number;
          p_employee_id: string;
          p_encerrar_anterior?: boolean;
          p_reason: string;
          p_valid_from: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      registrar_tarifa_contrato: {
        Args: {
          p_contract_id: string;
          p_daily_rate: number;
          p_encerrar_anterior?: boolean;
          p_job_function_id: string;
          p_reason: string;
          p_shift_period: string;
          p_valid_from: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      renomear_funcao: {
        Args: { p_id: string; p_name: string };
        Returns: undefined;
      };
      tarifa_contrato_na_data: {
        Args: {
          p_contract_id: string;
          p_data: string;
          p_job_function_id: string;
          p_shift_period: string;
        };
        Returns: {
          daily_rate: number;
          id: string;
          valid_from: string;
          valid_to: string | null;
        }[];
      };
      vincular_funcoes_exatas: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      registrar_adicional: {
        Args: {
          p_amount: number;
          p_billing_period_end?: string;
          p_billing_period_start?: string;
          p_client_id: string;
          p_description: string;
          p_operation_id?: string;
          p_period_end: string;
          p_period_start: string;
          p_reference?: string;
        };
        Returns: string;
      };
      registrar_condicao_contrato: {
        Args: {
          p_closing_period?: string;
          p_contract_id: string;
          p_daily_rate: number;
          p_encerrar_anterior?: boolean;
          p_holiday_pay_factor?: number;
          p_ot_factor: number;
          p_ot_rounding_mode?: string;
          p_ot_tolerance_min: number;
          p_reason: string;
          p_saturday_shift_hours?: number;
          p_shift_hours: number;
          p_valid_from: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      registrar_custo_colaborador: {
        Args: {
          p_daily_cost: number;
          p_employee_id: string;
          p_encerrar_anterior?: boolean;
          p_ot_hourly_cost?: number;
          p_reason: string;
          p_valid_from: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      registrar_feriado: {
        Args: { p_data: string; p_nome: string; p_reason: string };
        Returns: string;
      };
      registrar_valor_acordado_operacao: {
        Args: {
          p_agreed_amount: number;
          p_encerrar_anterior?: boolean;
          p_operation_id: string;
          p_reason: string;
          p_valid_from: string;
          p_valid_to?: string;
        };
        Returns: string;
      };
      regularizar_apontamento_legado: {
        Args: { p_aplicar?: boolean; p_entry_id: string; p_reason: string };
        Returns: Json;
      };
      resumo_financeiro_periodo: {
        Args: { p_client_id?: string; p_fim: string; p_inicio: string; p_operation_id?: string };
        Returns: {
          a_faturar: number;
          adicionais: number;
          ajuste_aplicavel: boolean;
          ajuste_faturado: number;
          ajuste_previsto: number;
          faturado: number;
          receita_apontamentos: number;
          receita_total: number;
        }[];
      };
      saldo_de_horas_do_periodo: {
        Args: { p_client_id: string; p_fim: string; p_inicio: string };
        Returns: {
          apontamentos: number;
          colaborador: string;
          employee_id: string;
          minutos_excedentes: number;
          minutos_faltantes: number;
          saldo: number;
        }[];
      };
      salvar_apontamento_admin: {
        Args: { p_linhas: Json; p_operation_id: string; p_shift_id?: string; p_work_date: string };
        Returns: Json;
      };
      salvar_apontamento_operacional: {
        Args: {
          p_linhas: Json;
          p_operation_id: string;
          p_shift_id: string;
          p_work_date: string;
        };
        Returns: string;
      };
      sincronizar_colunas_legadas: { Args: { p_reason: string }; Returns: Json };
      travar_turno_da_operacao: {
        Args: { p_operation_id: string; p_shift_id: string };
        Returns: boolean;
      };
      uid_do_operador: { Args: never; Returns: string };
      validar_fechamento_acumulado: {
        Args: { p_apontamentos: string[]; p_client_id: string; p_fim: string; p_inicio: string };
        Returns: undefined;
      };
      valor_acordado_operacao_na_data: {
        Args: { p_operation_id: string; p_work_date: string };
        Returns: {
          active: boolean;
          agreed_amount: number;
          created_at: string;
          created_by: string | null;
          id: string;
          operation_id: string;
          origin: string;
          reason: string;
          replaced_by: string | null;
          retired_at: string | null;
          valid_from: string;
          valid_to: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "operation_terms";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
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
