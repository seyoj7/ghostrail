"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Nav } from "../components/ui/Nav";
import "./page.css";

interface RegisteredService {
  id: string;
  name: string;
  endpointUrl: string;
  sellerWallet: string;
  priceUsdc: string;
  createdAt: string;
}

export default function ServicesPage() {
  const [services, setServices] = useState<RegisteredService[]>([]);
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [sellerWallet, setSellerWallet] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadServices = useCallback(async () => {
    try {
      const response = await fetch("/api/services");
      if (!response.ok) throw new Error("Could not load registered services");
      setServices(await response.json());
    } catch {
      setError("Could not load registered services.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadServices(), 0);
    return () => window.clearTimeout(timer);
  }, [loadServices]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, endpointUrl, sellerWallet, priceUsdc }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Registration failed");

      setServices((current) => [result, ...current]);
      setName("");
      setEndpointUrl("");
      setSellerWallet("");
      setPriceUsdc("");
      setNotice("Service registered.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <h2 className="services-heading">Register a service API</h2>
        <p className="mut services-intro">
          List an existing API with its Solana seller wallet and devnet USDC price.
          Registration does not call or proxy your API, and does not verify ownership.
        </p>

        <form className="card service-form" onSubmit={handleSubmit}>
          <label className="service-field">
            <span>Service name</span>
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name of your service"
            />
          </label>
          <label className="service-field">
            <span>Service API URL</span>
            <input
              required
              type="url"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://api.example.com/resource"
            />
          </label>
          <label className="service-field">
            <span>Seller Solana wallet</span>
            <input
              required
              value={sellerWallet}
              onChange={(event) => setSellerWallet(event.target.value)}
              placeholder="Public address"
              autoComplete="off"
            />
          </label>
          <label className="service-field">
            <span>Price (devnet USDC)</span>
            <input
              required
              type="number"
              min="0.000001"
              step="0.000001"
              value={priceUsdc}
              onChange={(event) => setPriceUsdc(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <div className="service-form-footer">
            <button className="btn service-submit" type="submit" disabled={submitting}>
              {submitting ? "Registering..." : "Register service"}
            </button>
            {error && <p className="bad service-message" role="alert">{error}</p>}
            {notice && <p className="ok service-message" role="status">{notice}</p>}
          </div>
        </form>

        <section className="service-list" aria-labelledby="registered-services-title">
          <h2 className="service-list-heading" id="registered-services-title">
            Registered services
          </h2>
          {loading && <p className="mut">Loading services...</p>}
          {!loading && error && services.length === 0 && (
            <p className="mut">Service registrations could not be loaded.</p>
          )}
          {!loading && !error && services.length === 0 && (
            <p className="mut">No services have been registered yet.</p>
          )}
          {services.map((service) => (
            <article className="card service-entry" key={service.id}>
              <div className="service-entry-header">
                <h3>{service.name}</h3>
                <span className="service-unverified">Unverified</span>
              </div>
              <a href={service.endpointUrl} target="_blank" rel="noreferrer">
                {service.endpointUrl}
              </a>
              <div className="service-entry-meta">
                <span>{service.priceUsdc} devnet USDC</span>
                <span className="mono">Seller: {service.sellerWallet}</span>
              </div>
              <div className="service-id-row">
                <span className="mono service-id-value">
                  Service ID: {service.id}
                </span>
                <button
                  className="copy-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(service.id);
                  }}
                  title="Copy service ID"
                >
                  Copy ID
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
