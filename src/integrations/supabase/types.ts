export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          org_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          org_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_key: string
          created_at: string
          depth: number
          error: string | null
          finished_at: string | null
          id: string
          org_id: string
          status: string
          summary: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_key: string
          created_at?: string
          depth?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          org_id: string
          status?: string
          summary?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_key?: string
          created_at?: string
          depth?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          org_id?: string
          status?: string
          summary?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_reservations: {
        Row: {
          charged: number | null
          created_at: string
          org_id: string
          reserved: number
          run_id: string
          settled_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          charged?: number | null
          created_at?: string
          org_id: string
          reserved: number
          run_id: string
          settled_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          charged?: number | null
          created_at?: string
          org_id?: string
          reserved?: number
          run_id?: string
          settled_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_reservations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_credit_reservations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          cost_estimate_eur: number
          created_at: string
          credits_charged: number
          id: number
          input_tokens: number
          model: string
          org_id: string
          output_tokens: number
          provider: string
          run_id: string | null
          user_id: string
        }
        Insert: {
          cost_estimate_eur?: number
          created_at?: string
          credits_charged?: number
          id?: never
          input_tokens?: number
          model: string
          org_id: string
          output_tokens?: number
          provider: string
          run_id?: string | null
          user_id: string
        }
        Update: {
          cost_estimate_eur?: number
          created_at?: string
          credits_charged?: number
          id?: never
          input_tokens?: number
          model?: string
          org_id?: string
          output_tokens?: number
          provider?: string
          run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          capability_key: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          expected_impact: string | null
          id: string
          org_id: string
          payload: Json
          reasoning: string | null
          requested_by: string
          risk: string
          run_id: string | null
          status: Database["public"]["Enums"]["approval_status"]
          title: string
          workspace_id: string | null
        }
        Insert: {
          capability_key: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expected_impact?: string | null
          id?: string
          org_id: string
          payload?: Json
          reasoning?: string | null
          requested_by: string
          risk?: string
          run_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          title: string
          workspace_id?: string | null
        }
        Update: {
          capability_key?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expected_impact?: string | null
          id?: string
          org_id?: string
          payload?: Json
          reasoning?: string | null
          requested_by?: string
          risk?: string
          run_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          title?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          metadata: Json
          org_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          org_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          org_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      billing_profiles: {
        Row: {
          address: string | null
          country: string | null
          legal_name: string | null
          org_id: string
          reverse_charge: boolean
          updated_at: string
          vat_id: string | null
          vat_validated: boolean
        }
        Insert: {
          address?: string | null
          country?: string | null
          legal_name?: string | null
          org_id: string
          reverse_charge?: boolean
          updated_at?: string
          vat_id?: string | null
          vat_validated?: boolean
        }
        Update: {
          address?: string | null
          country?: string | null
          legal_name?: string | null
          org_id?: string
          reverse_charge?: boolean
          updated_at?: string
          vat_id?: string | null
          vat_validated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "billing_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_facts: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          key: string
          org_id: string
          source_ref: string | null
          source_type: Database["public"]["Enums"]["fact_source"]
          value: string
          verified: boolean
          workspace_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          key: string
          org_id: string
          source_ref?: string | null
          source_type: Database["public"]["Enums"]["fact_source"]
          value: string
          verified?: boolean
          workspace_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          key?: string
          org_id?: string
          source_ref?: string | null
          source_type?: Database["public"]["Enums"]["fact_source"]
          value?: string
          verified?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_facts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          audiences: Json
          business_model: string | null
          competitors: Json
          description: string | null
          industry: string | null
          markets: Json
          monthly_budget_eur: number | null
          objectives: Json
          offerings: Json
          onboarding_completed_at: string | null
          org_id: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          audiences?: Json
          business_model?: string | null
          competitors?: Json
          description?: string | null
          industry?: string | null
          markets?: Json
          monthly_budget_eur?: number | null
          objectives?: Json
          offerings?: Json
          onboarding_completed_at?: string | null
          org_id: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          audiences?: Json
          business_model?: string | null
          competitors?: Json
          description?: string | null
          industry?: string | null
          markets?: Json
          monthly_budget_eur?: number | null
          objectives?: Json
          offerings?: Json
          onboarding_completed_at?: string | null
          org_id?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience: string
          budget_eur: number
          category: string
          channels: string[]
          created_at: string
          created_by: string
          description: string
          end_date: string | null
          id: string
          objective: string
          org_id: string
          owner_id: string | null
          priority: string
          results: string
          source_message_id: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          audience?: string
          budget_eur?: number
          category?: string
          channels?: string[]
          created_at?: string
          created_by?: string
          description?: string
          end_date?: string | null
          id?: string
          objective?: string
          org_id: string
          owner_id?: string | null
          priority?: string
          results?: string
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          audience?: string
          budget_eur?: number
          category?: string
          channels?: string[]
          created_at?: string
          created_by?: string
          description?: string
          end_date?: string | null
          id?: string
          objective?: string
          org_id?: string
          owner_id?: string | null
          priority?: string
          results?: string
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_connections: {
        Row: {
          config: Json
          connector_key: string
          created_at: string
          id: string
          org_id: string
          status: string
          workspace_id: string | null
        }
        Insert: {
          config?: Json
          connector_key: string
          created_at?: string
          id?: string
          org_id: string
          status?: string
          workspace_id?: string | null
        }
        Update: {
          config?: Json
          connector_key?: string
          created_at?: string
          id?: string
          org_id?: string
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          org_id: string
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          title?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      coordinated_analyses: {
        Row: {
          conversation_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          message_id: string | null
          org_id: string
          partial_results: Json
          request_key: string
          run_ids: string[]
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input: Json
          message_id?: string | null
          org_id: string
          partial_results?: Json
          request_key: string
          run_ids: string[]
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          message_id?: string | null
          org_id?: string
          partial_results?: Json
          request_key?: string
          run_ids?: string[]
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordinated_analyses_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordinated_analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordinated_analyses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coordinated_analyses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: number
          org_id: string
          reason: string
          ref: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: never
          org_id: string
          reason: string
          ref?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: never
          org_id?: string
          reason?: string
          ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          extracted_text: string | null
          id: string
          mime: string
          name: string
          org_id: string
          size_bytes: number
          status: string
          storage_path: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          id?: string
          mime: string
          name: string
          org_id: string
          size_bytes: number
          status?: string
          storage_path: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          id?: string
          mime?: string
          name?: string
          org_id?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_conversions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          org_id: string
          request_key: string
          result: Json
          source_message_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          kind: string
          org_id: string
          request_key: string
          result: Json
          source_message_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          org_id?: string
          request_key?: string
          result?: Json
          source_message_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_conversions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_conversions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_conversions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_notes: {
        Row: {
          body: string
          completed: boolean
          content_type: string
          created_at: string
          created_by: string
          due_date: string | null
          entity_id: string
          entity_type: string
          id: string
          kind: string
          org_id: string
          related_id: string | null
          storage_path: string | null
          title: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          body?: string
          completed?: boolean
          content_type?: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          entity_id: string
          entity_type: string
          id?: string
          kind: string
          org_id: string
          related_id?: string | null
          storage_path?: string | null
          title?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          completed?: boolean
          content_type?: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: string
          org_id?: string
          related_id?: string | null
          storage_path?: string | null
          title?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          org_id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          org_id: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          parent_org_id: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_org_id?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_org_id?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          feature_key: string
          limit_value: number | null
          plan_key: string
        }
        Insert: {
          feature_key: string
          limit_value?: number | null
          plan_key: string
        }
        Update: {
          feature_key?: string
          limit_value?: number | null
          plan_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          is_public: boolean
          key: string
          monthly_credits: number
          name: string
          price_monthly_eur: number | null
          price_yearly_eur: number | null
          tier: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          is_public?: boolean
          key: string
          monthly_credits?: number
          name: string
          price_monthly_eur?: number | null
          price_yearly_eur?: number | null
          tier: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          is_public?: boolean
          key?: string
          monthly_credits?: number
          name?: string
          price_monthly_eur?: number | null
          price_yearly_eur?: number | null
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      policies: {
        Row: {
          capability_key: string
          mode: string
          org_id: string
          updated_at: string
        }
        Insert: {
          capability_key: string
          mode: string
          org_id: string
          updated_at?: string
        }
        Update: {
          capability_key?: string
          mode?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          locale: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          locale?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          locale?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          category: string
          created_at: string
          created_by: string
          description: string
          end_date: string | null
          id: string
          objective: string
          org_id: string
          owner_id: string | null
          priority: string
          source_message_id: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string
          description?: string
          end_date?: string | null
          id?: string
          objective?: string
          org_id: string
          owner_id?: string | null
          priority?: string
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          description?: string
          end_date?: string | null
          id?: string
          objective?: string
          org_id?: string
          owner_id?: string | null
          priority?: string
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          created_at: string
          current_period_start: string
          org_id: string
          plan_key: string
          provider: string
          provider_ref: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          created_at?: string
          current_period_start?: string
          org_id: string
          plan_key: string
          provider?: string
          provider_ref?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          created_at?: string
          current_period_start?: string
          org_id?: string
          plan_key?: string
          provider?: string
          provider_ref?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      tasks: {
        Row: {
          agent_key: string | null
          campaign_id: string | null
          created_at: string
          created_by: string
          description: string
          due_date: string | null
          id: string
          labels: string[]
          org_id: string
          owner_id: string | null
          parent_task_id: string | null
          priority: string
          project_id: string | null
          recurrence: string
          recurrence_source_id: string | null
          source_message_id: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_key?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          due_date?: string | null
          id?: string
          labels?: string[]
          org_id: string
          owner_id?: string | null
          parent_task_id?: string | null
          priority?: string
          project_id?: string | null
          recurrence?: string
          recurrence_source_id?: string | null
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_key?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          due_date?: string | null
          id?: string
          labels?: string[]
          org_id?: string
          owner_id?: string | null
          parent_task_id?: string | null
          priority?: string
          project_id?: string | null
          recurrence?: string
          recurrence_source_id?: string | null
          source_message_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_campaign_id_org_id_workspace_id_fkey"
            columns: ["campaign_id", "org_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "org_id", "workspace_id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_org_id_workspace_id_fkey"
            columns: ["parent_task_id", "org_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "org_id", "workspace_id"]
          },
          {
            foreignKeyName: "tasks_project_id_org_id_workspace_id_fkey"
            columns: ["project_id", "org_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "org_id", "workspace_id"]
          },
          {
            foreignKeyName: "tasks_recurrence_source_id_fkey"
            columns: ["recurrence_source_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_extensions: {
        Row: {
          config: Json
          enabled: boolean
          extension_key: string
          org_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          enabled?: boolean
          extension_key: string
          org_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          enabled?: boolean
          extension_key?: string
          org_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_extensions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_extensions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      admin_grant_credits: {
        Args: { _amount: number; _note: string; _org: string }
        Returns: undefined
      }
      begin_coordinated_analysis: {
        Args: {
          _input: Json
          _org: string
          _request: string
          _workspace: string
        }
        Returns: Json
      }
      begin_coordinated_analysis_verified: {
        Args: {
          _input: Json
          _org: string
          _proof: string
          _request: string
          _workspace: string
        }
        Returns: Json
      }
      checkpoint_coordinated_analysis: {
        Args: { _id: string; _step: number; _text: string }
        Returns: undefined
      }
      checkpoint_coordinated_analysis_verified: {
        Args: { _id: string; _proof: string; _step: number; _text: string }
        Returns: undefined
      }
      confirm_business_profile: {
        Args: { _facts: Json; _profile: Json; _workspace: string }
        Returns: undefined
      }
      consume_credits: {
        Args: { _amount: number; _org: string; _ref: string }
        Returns: number
      }
      convert_execution_plan: {
        Args: {
          _kind: string
          _plan: Json
          _request: string
          _source: string
          _workspace: string
        }
        Returns: Json
      }
      create_invitation: {
        Args: {
          _email: string
          _org: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      create_organization: {
        Args: { _name: string; _workspace_name: string }
        Returns: string
      }
      create_workspace: {
        Args: { _name: string; _org: string }
        Returns: string
      }
      credit_balance: { Args: { _org: string }; Returns: number }
      decide_approval: {
        Args: { _approve: boolean; _id: string; _note: string }
        Returns: Database["public"]["Enums"]["approval_status"]
      }
      document_path_access: {
        Args: { _min: Database["public"]["Enums"]["org_role"]; _path: string }
        Returns: boolean
      }
      ensure_monthly_credit_grant: { Args: { _org: string }; Returns: number }
      execution_user_allowed: {
        Args: { _user: string; _workspace: string }
        Returns: boolean
      }
      execution_workspace_members: {
        Args: { _workspace: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      fail_coordinated_analysis: {
        Args: { _error: string; _id: string }
        Returns: undefined
      }
      fail_coordinated_analysis_verified: {
        Args: { _error: string; _id: string; _proof: string }
        Returns: undefined
      }
      finish_coordinated_analysis: {
        Args: { _id: string; _reply: string }
        Returns: Json
      }
      finish_coordinated_analysis_verified: {
        Args: { _id: string; _proof: string; _reply: string }
        Returns: Json
      }
      has_org_role: {
        Args: { _min: Database["public"]["Enums"]["org_role"]; _org: string }
        Returns: boolean
      }
      has_platform_role: {
        Args: { _role: Database["public"]["Enums"]["platform_role"] }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          _min?: Database["public"]["Enums"]["org_role"]
          _workspace: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      is_platform_staff: { Args: never; Returns: boolean }
      log_audit: {
        Args: {
          _action: string
          _metadata?: Json
          _org: string
          _target_id: string
          _target_type: string
        }
        Returns: undefined
      }
      org_entitlement: {
        Args: { _feature: string; _org: string }
        Returns: number
      }
      refund_ai_credits: { Args: { _run: string }; Returns: number }
      refund_ai_credits_verified: {
        Args: { _proof: string; _run: string }
        Returns: number
      }
      repeat_execution_task: { Args: { _task: string }; Returns: string }
      reserve_ai_credits: {
        Args: { _amount: number; _run: string }
        Returns: number
      }
      role_rank: {
        Args: { _r: Database["public"]["Enums"]["org_role"] }
        Returns: number
      }
      set_workspace_member: {
        Args: {
          _role?: Database["public"]["Enums"]["org_role"]
          _user: string
          _workspace: string
        }
        Returns: undefined
      }
      settle_ai_credits: {
        Args: {
          _actual: number
          _cost_estimate_eur: number
          _input_tokens: number
          _model: string
          _output_tokens: number
          _provider: string
          _run: string
        }
        Returns: number
      }
      settle_ai_credits_verified: {
        Args: {
          _actual: number
          _cost_estimate_eur: number
          _input_tokens: number
          _model: string
          _output_tokens: number
          _proof: string
          _provider: string
          _run: string
        }
        Returns: number
      }
      shares_org_with: { Args: { _user: string }; Returns: boolean }
      verify_ai_accounting: { Args: { _proof: string }; Returns: undefined }
      ws_org: { Args: { _ws: string }; Returns: string }
    }
    Enums: {
      approval_status:
        | "pending"
        | "approved"
        | "rejected"
        | "executed"
        | "failed"
        | "expired"
      fact_source:
        | "user"
        | "document"
        | "website"
        | "ai_assumption"
        | "external"
      org_role: "owner" | "admin" | "member" | "viewer"
      platform_role: "platform_owner" | "support" | "finance"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_status: [
        "pending",
        "approved",
        "rejected",
        "executed",
        "failed",
        "expired",
      ],
      fact_source: ["user", "document", "website", "ai_assumption", "external"],
      org_role: ["owner", "admin", "member", "viewer"],
      platform_role: ["platform_owner", "support", "finance"],
    },
  },
} as const
