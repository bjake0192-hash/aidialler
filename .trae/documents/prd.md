# Product Requirements Document (PRD) - OpenLead AI Dialler

## 1. Product Overview
OpenLead AI Dialler is a premium AI-powered outbound calling platform designed to qualify prospects at scale. It leverages OpenAI's Realtime API and Twilio to conduct natural, low-latency voice conversations that identify high-intent leads.

- **Main Purpose**: Automate outbound cold calling and lead qualification.
- **Problem to Solve**: Sales teams spend hours on manual cold calls with low conversion; AI can filter and qualify leads 24/7.
- **Target Users**: B2B sales teams, recruitment agencies, and real estate agencies.

## 2. Core Features

### 2.1 User Roles
| Role | Registration Method | Core Permissions |
|------|---------------------|------------------|
| Admin | Email/Google Auth | Manage campaigns, upload leads, view analytics, configure AI settings |

### 2.2 Feature Modules
1. **Campaign Dashboard**: Overview of active calls, success rates, and lead qualification metrics.
2. **Lead Management**: Interface to upload CSVs of mobile numbers and track lead status.
3. **AI Persona Configurator**: Define the voice (Alloy, Echo, etc.), instructions, and qualifying questions.
4. **Call Logs & Transcripts**: Real-time monitoring and historical logs of all conversations.

### 2.3 Page Details
| Page Name | Module Name | Feature Description |
|-----------|-------------|---------------------|
| Dashboard | Hero Stats | Real-time display of total calls, qualified leads, and conversion rate. |
| Leads | Lead Table | List of prospects with status (Pending, Called, Qualified, Rejected). |
| Settings | AI Config | Sliders for AI personality, text area for custom system instructions. |
| Call View | Live Stream | Visual representation of an active call with live transcript. |

## 3. Core Process
1. User uploads a list of mobile numbers (leads).
2. User configures the AI persona and qualification criteria.
3. System initiates outbound calls via Twilio.
4. AI conducts the conversation, following the qualification script.
5. Conversation ends; AI summarizes the call and marks the lead status.
6. Admin reviews qualified leads in the dashboard.

```mermaid
graph TD
    "Start Campaign" --> "Fetch Lead"
    "Fetch Lead" --> "Initiate Twilio Call"
    "Initiate Twilio Call" --> "Connect Media Stream"
    "Connect Media Stream" --> "AI Conversation (OpenAI Realtime)"
    "AI Conversation" --> "Qualify Prospect"
    "Qualify Prospect" --> "Update Lead Status"
    "Update Lead Status" --> "End Call"
```

## 4. User Interface Design

### 4.1 Design Style
- **Primary Color**: Deep Indigo (`#4F46E5`) with Cyan (`#06B6D4`) accents.
- **Theme**: Dark Mode (background: `#030712`).
- **Aesthetic**: Glassmorphism, blue glowing effects (glow-indigo), soft gradients.
- **Typography**: "Cal Sans" for headings, "Inter" for body text.
- **Layout**: Sidebar navigation with a spacious, card-based main content area.

### 4.2 Page Design Overview
| Page Name | Module Name | UI Elements |
|-----------|-------------|-------------|
| Dashboard | Analytics Grid | Glassmorphic cards with glowing borders and smooth entrance animations. |
| Leads | Data Table | Clean, high-density table with soft hover states and status badges. |

### 4.3 Responsiveness
- Desktop-first design with high-end animations.
- Mobile-adaptive for viewing stats on the go.
- Touch optimization for lead status toggling.
