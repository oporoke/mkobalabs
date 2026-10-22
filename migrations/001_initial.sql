--
-- PostgreSQL database dump
--

\restrict MEW4FQeF09Xbx0csAMbPtzQIJvZbEdCWIgDEgOKGBSZf12b0vEqcw51frXhvAyd

-- Dumped from database version 18.6 (Ubuntu 18.6-1.pgdg24.04+2)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: messages_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages_log (
    id bigint NOT NULL,
    phone_number text NOT NULL,
    channel text NOT NULL,
    direction text NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    wa_message_id text,
    vendor_id bigint
);


--
-- Name: messages_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_log_id_seq OWNED BY public.messages_log.id;


--
-- Name: parse_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parse_feedback (
    id bigint NOT NULL,
    vendor_id bigint NOT NULL,
    message_id bigint,
    text text NOT NULL,
    reason text NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT parse_feedback_reason_check CHECK ((reason = ANY (ARRAY['not_understood'::text, 'rejected'::text, 'corrected'::text])))
);


--
-- Name: parse_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parse_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parse_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parse_feedback_id_seq OWNED BY public.parse_feedback.id;


--
-- Name: report_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_log (
    vendor_id bigint NOT NULL,
    period text NOT NULL,
    report_date date NOT NULL,
    sent_via text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id bigint NOT NULL,
    vendor_id bigint NOT NULL,
    type text,
    direction text,
    amount_tsh numeric(14,2) NOT NULL,
    raw_input text,
    channel text,
    parse_confidence numeric(4,3),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    message_id bigint,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone,
    status text DEFAULT 'confirmed'::text NOT NULL,
    item text,
    quantity numeric(12,3),
    unit text,
    counterparty text,
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'pending'::text])))
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id bigint NOT NULL,
    phone_number text NOT NULL,
    name text,
    onboarded_via text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    business_type text,
    onboarding_step text,
    daily_report boolean DEFAULT true NOT NULL
);


--
-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;


--
-- Name: messages_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log ALTER COLUMN id SET DEFAULT nextval('public.messages_log_id_seq'::regclass);


--
-- Name: parse_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parse_feedback ALTER COLUMN id SET DEFAULT nextval('public.parse_feedback_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);


--
-- Name: messages_log messages_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_pkey PRIMARY KEY (id);


--
-- Name: messages_log messages_log_wa_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_wa_message_id_key UNIQUE (wa_message_id);


--
-- Name: parse_feedback parse_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parse_feedback
    ADD CONSTRAINT parse_feedback_pkey PRIMARY KEY (id);


--
-- Name: report_log report_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_log
    ADD CONSTRAINT report_log_pkey PRIMARY KEY (vendor_id, period, report_date);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_phone_number_key UNIQUE (phone_number);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: messages_log messages_log_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_log
    ADD CONSTRAINT messages_log_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: parse_feedback parse_feedback_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parse_feedback
    ADD CONSTRAINT parse_feedback_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages_log(id);


--
-- Name: parse_feedback parse_feedback_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parse_feedback
    ADD CONSTRAINT parse_feedback_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: report_log report_log_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_log
    ADD CONSTRAINT report_log_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: transactions transactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages_log(id);


--
-- Name: transactions transactions_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- PostgreSQL database dump complete
--

\unrestrict MEW4FQeF09Xbx0csAMbPtzQIJvZbEdCWIgDEgOKGBSZf12b0vEqcw51frXhvAyd

