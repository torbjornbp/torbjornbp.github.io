---
layout: presentation2
category: documents
title: CDC Presentation 25.04.2023
---

# Preservation metadata at the NLN
### Present/future concept
Torbjørn Pedersen / 25.04.2023

Content for slide 1

---

# MAVIS
### “Merged Audio-Visual Information System” 

- CMS: Mavis 1996 -> 2024
- Central system for all AV-materials (still images, sound recordings and moving images +++)
	- Not just a catalog: names, acquisitions, conditions, treatments, loans, locations, etc. 
	- Analog and digital material
- Old! 
	- Complicated system integrations (to maintain/to create) - no modern APIs
	- Non-standard data model
	- End of life!
- Ongoing migration to Axiell Collections (deadline 2024)

---

# Mavis

Content for slide 4

---

# Scanning/post-processing workflow 

- Preservation processes tend follow predefined steps with predefined roles responsible

- Film archivist: Selection of materials, decisions on project scope etc. -> Creation of “Smartsheet” preservation order

---

# Smartsheet
### Workflow/processing

---

# Film preparation

- Preparers: Condition reporting -> Manually documented in Mavis
- Preparers: Treatment -> Manually documented in Mavis
- Preparers: Cleaning -> manually documented in Mavis

- High detail! Track changes in material

---

# Slide 4

- Digital lab technicians: Scanning
	- Mavis integrated application -> automatic creation of new Mavis records (DPX/WAVs) with copying history, tech metadata, scanner parameters, URNs. Harvests all relevant data.
	- Mavis integrated application -> preservation packages and proxies generated and preserved automatically with METS
- Digital lab technicians: Post-processing (restoration, grading, etc)
	- Mavis integrated application -> automatic creation of new Mavis records (preservation master) with copying history, tech metadata, URNs.
	- Mavis integrated application -> preservation packages and proxies generated and preserved automatically with METS

- Easy creation of rich and consistent metadata
- Digital lab technicians use smartsheet (+ additional smartsheets), but does not use Mavis…
	- Anything not defined by system integration has to be documented manually! Decisions and tools used by lab technicians not documented systematically!
- Lack of resources for maintenance/updates -> Current integrations strict and inflexible 

---
