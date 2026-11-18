import React from "react";
import "./Home.css";
import LandingNavbar from "./landing/LandingNavbar";
import Hero from "./landing/Hero";
import Stats from "./landing/Stats";
import Features from "./landing/Features";
import HowItWorks from "./landing/HowItWorks";
import DashboardShowcase from "./landing/DashboardShowcase";
import WhyChooseUs from "./landing/WhyChooseUs";
import CTA from "./landing/CTA";
import Footer from "./landing/Footer";

export default function Home() {
  return (
    <div className="ln-home">
      <LandingNavbar />
      <main>
        <Hero />
        <Stats />
        <Features />
        <HowItWorks />
        <DashboardShowcase />
        <WhyChooseUs />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
