
# MAVIS - “Merged Audio-Visual Information System” 

**CMS: Mavis 1996 -> 2024**
- **Central system for all AV-materials** (still images, sound recordings and moving images +++)
	- Not just a catalog: names, acquisitions, conditions, treatments, loans, locations, etc. 
	- Analog and digital material

<br>
- **Old!** 
	- Complicated system integrations (to maintain/to create) - no modern APIs
	- Not particularly user friendly
	- Non-standard data model
	- End of life!

<br>	
- Ongoing migration to Axiell Collections (deadline 2024)

![1](/assets/img/cdc25042023/1.png){:.ioda}

---

# Mavis

- Windows client, oracle database, interface based on a window per record, with multiple tabs dividing information

![2](/assets/img/cdc25042023/2.png)

---

# Scanning/post-processing workflow 

- **Preservation processes tend follow predefined steps with predefined roles responsible**

- **Film archivist:** Selection of materials, decisions on project scope etc. -> Creation of “Smartsheet” preservation order

![3](/assets/img/cdc25042023/3.png)

---

# Smartsheet
### Workflow/processing

**Pros:** 
- Easy to use
- Web interface
- Nice overview of projects/available resources

**Cons:** 
- Not a catalog
- Not integrated with any other systems
- Redundant bookkeeping/metadata creation (eg. the same things are documented in both mavis/smartsheet)
- Yet another system to deal with…

![4](/assets/img/cdc25042023/4.png)

---

# Film preparation

- **Preparers:** Condition reporting -> Manually documented in Mavis
- **Preparers:** Treatment -> Manually documented in Mavis
- **Preparers:** Cleaning -> manually documented in Mavis

<br>
**Pros:** 
- High detail! 
- Track changes in material
- Intuitive placement of metadata

**Cons:**
- "Deep" placement of metadata in datamodel
- No media reference support

![mavis conditions](/assets/img/cdc25042023/condition.png)

---

# Scanning/post-processing

**Digital lab technicians:** Scanning
- **Mavis integrated application** -> automatic creation of new Mavis records (DPX/WAVs) with copying history, tech metadata, equipment used, scanner parameters, URNs. Harvests all relevant data.
- **Mavis integrated application** -> preservation packages and proxies generated and preserved automatically with METS

**Digital lab technicians:** Post-processing (restoration, grading, etc)
- **Mavis integrated application** -> automatic creation of new Mavis records (preservation master) with copying history, tech metadata, URNs.
- **Mavis integrated application** -> preservation packages and proxies generated and preserved automatically with METS

<br>
**Pros:**
- Easy creation of rich and consistent metadata!

**Cons:**
- Digital lab technicians use smartsheet (+ additional smartsheets), but does not use Mavis…
	- Anything not defined by system integration not documented -> Decisions and tools used by lab technicians not documented systematically!
- Lack of resources for maintenance/updates -> Current integrations strict and inflexible 

![mavis digital carrier](/assets/img/cdc25042023/digcarrier.png)

---

# Importance of documenting scanner paramenters

Document parameter choices influencing your resulting files!

- What is the result of the scanning process? What is the result further processing in the scanner?

**Scanner capture parameters**
- Light intensity / RGB balance
- Selected light source (if multiple available options, like the Scanity’s different red LEDs)
- HDR/Triple flashes/etc

**Scanner processing parameters**
- Color space/gamma manipulations etc. (Log/Lin is not enough, document log/lin flavour)
- Specific LUTs used
- Scaling/downsampling

This information is crucial! Provides context to your scans: Eg. Did the scanned film have very high density, or was the scanner lights set up in a faulty manner?
- This is information not found in the DPX header

---

## Preservation reporting

**Film archivist:** quality control acceptance -> Manually entered preservation report in Mavis
- Overarching description of entire project + previous steps of note + achievement of goals

<br>
**Pros:**
- Strong documentation of decisions, aims, goals, success of the project

**Cons:**
- Time consuming -> puts pressure on limited archivist resources
- Preservation report at work level, in a single, non-repeatable field
- Records get messy and chaotic if they have undergone multiple or complex preservation processes

---

# Current preservation metadata core building blocks

**Preservation report** -> Text field at title level

**Copying history** -> Relation between carriers (and components for practical reasons)

**Treatments/conditions** -> basic events related to carrier

**Scanner parameters** -> Range of fields and related reference file at carrier level

<br>
**Technical metadata** -> Range of fields at component
- Not preservation metadata per se, but generated/enriched as part of the preservation process. 
- Automatically entered for new digital records

![mavis preservation](/assets/img/cdc25042023/mavispres.png){:.ioda}

---
# Principles moving forward

**Keep pros/limit cons**

**1. CMS as master system for metadata + compliance to metadata standards**
- All metadata in one location
- Manifestation level opens new possibilities
- Reference files as metadata

**2. Extended use of workflow tools**
- Increased user friendliness/Easier data-entry
- Better control over processes
- Workflow processing generates metadata
- Easier automation

**3. More detailed documentation**
- Expanded use of events (and event-like entities)
- Reference files as metadata

---

# 1. CMS as metadata master

**Requirements:** Standardised metadata, easier system integrations/modern APIs, configurable system
- Achieved through implementation of Axiell Collections

**Expected benefits**: 
- Manifestation level
	- Preservation type manifestations -> Grouping of preservation items in the catalog hierarchy
	- Preservation report -> Manifestation Simplifies our current long-form prose preservation reports
		- Information in controlled manifestation fields (eg. Dates, responsible personell, scope, etc.)
- All records can have related reference materials in Collections
	- No need for controlled fields for everything. Files can be attached to records - Extracted file header information, scanner parameters, mediainfo, mediatrace reports etc.)
	- Media files as metadata (media reference files are “worth a thousand words”)

![mediareference](/assets/img/cdc25042023/mediareference.jpg)


---
# 2. Extended use of workflow tools

**Requirement:** Workflow process tool should be able to read/write to Axiell Collections.
- Hopefully achieved through implementation of Axiell Flow (or other tool)

**Expected benefits:**
- Better overview and coordination of processes and progress
- Tasks can be assigned to roles/individuals
- Simplified data entry (eg. through the use of forms)
	- Easier for non-catalogers to add metadata, more consistent formatting
	- Metadata entered at the correct catalog “coordinates”
- Orders related to the actual catalog records 
	- Access to catalog metadata in the workflow interface
	- History of orders a record has been part of
- Easier system integrations
	- Workflows can consist of both human steps and machine data processing steps (eg. moving files, RAWcooked packaging)

---

# 3. More detailed documentation
**Requirement:** Configuration of fields missing from Mavis, more flexible CMS data model
- Achieved through implementation of Axiell Collections

**Expected benefits:**
- New and more advanced “treatment events” (records related to a record, rather than metadata on a record)
	- Expanded view of treatments lets us document more information with context (eg. Scanning, grading etc. A DCDM is the result of attached events documenting decisions)
	- New event entities can hold complex metadata
	- Can be related to any and multiple record in the Collections -> can function as nodes relating two records together
		- Eg. Copying history as scanning event related to scanned film material and the produced DPX sequence. Scanner parameters could sit at the event
- Reference material allows for more metadata to be entered into the catalog
- Simplifies preservation report: instead of stating “I did x, y and z etc.” that information can be added as events/treatment metadata, by whoever actually performed the action

---

# Future concept?

- Workflow orders (with its instructions, type etc.) recorded as records in an orders database
- The steps of the workflow are automatically created as events/treatments of the material, as the step is performed (eg. an “assessment/preparation for scanning” step)

	- Allows for better/easier capture of some metadata (eg. to complete the grading step and save the files, the operator has to add some metadata (what software was used, was a reference used, etc.)
	- Why go to the full, complex catalog post to assess materials if you can go to a simple interface where you only have access to the exact fields you need?
- Any metadata entered through the workflows end up at the correct fields in the CMS (eg. A new condition is added)
- You create metadata just by going through the workflow steps
- Order history and relations can document the reason for/what initiated some metadata to be created. Eg. You could relate all treatments to a workflow assessment/treatment step, which again is related to an order for example)

![concept](/assets/img/cdc25042023/concept.png){:.ioda}