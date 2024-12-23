---
title: Practical cataloging principles
date: '2023-10-20'
description: A text spelling out various suggestions for how to approach cataloging and asset description in a practical manner.
categories:
  - cataloging
tags:
  - FRBR
  - LRM
  - EN15907
  - Film cataloging
  - Asset management
  - cataloging
aliases: "/cataloging-principles.html"
---

I have typed out various specific cataloging procedures, I have pushed for certain cataloging changes, and I have specified requirements of our new cataloging system, but I have never spelled out the overarching principles I base my thoughts on. 

This post is an attempt to start spelling out some possible overarching principles about cataloging. 
Perhaps some ideas make little sense outside of my organization due to organizational specifics, but I think at least some of these principles could be of use elsewhere. 
I will try to illustrate the point of these principles using a practical challenge from the cataloging of our filmographic collection.

{{< toc >}}

## Content description
Cataloging, at its core, is the act of describing something - *what is it?* - to enable some sort of use of the metadata. 
I won't go into detail about the many possible uses of metadata, but the aims proposed in FRBR for example, is a good starting point: to **find**, **identify**, **select**, and **obtain**.

However, there are many systems of description to choose from. 
The metadata models typically used for filmographic description are models with a *content* focus. 
These standards typically come from the library world. 

It seems almost too obvious to need clarification, but by *content* I refer to the information contained in the material media. 
The experienced sound and images, the narrative, what was in front of the camera. 
It is film as icon and index. 
It is film primarily as message, less importantly as media. 
Film as cultural object, not as material culture. 
It is a focus on film in the abstract sense, as opposed to looking at film as tangible objects. 

The reason I bring this up is that this is one way, of many, to look at film[^1]. 
Your cataloging is influenced by the various *frameworks* you work within.
>Principle: Identify the frameworks you are working within and have clarity about what you want to achieve.

## Descriptive frameworks
Here at the National Library, we usually operate within this *content framework* when we talk about cataloging. 
Simply put: our core cataloging aim has been to identify film content.

Still, when dealing with our film collection, it is the *tangible* film objects we are trying to describe and systematize. 
It is typically the handling of these objects that triggers any sort of cataloging to happen. 
Preservation events, material identification etc. 
is usually what has initiated my dives into work level data. 
I rarely spend time cataloging film works without the work being represented in our collection in any form.
	
The description of our collection objects is also where we have the largest amount of *cataloging debt*. 
We have vast amounts of material not described in our cataloging systems, and getting it catalogued continues to be a major challenge. 
There's no way of getting around the fact that material identification is time-consuming – we are working with *time-based* media, after all. 

When confronted with a chemically deteriorating lump of nitrate film, determining "what it is" can be extremely challenging. 
I know it's nitrate, I know it is a film reel, but what content it carries can be hard to say. 
We have tended to equate cataloging with identifying the content of media. 
Part of the reason for this is our situation within this descriptive framework, but another reason is purely technical.

## Technical frameworks
You do not only operate within a descriptive framework, you also operate within a *technical* framework. 
In the same way as there are different metadata standards you can use, there are different tools and computer systems that allow you to use them. 
In the National Library, the primary tool for audiovisual description is the collection management system **Mavis** (Merged Audio Visual Information System). 

Creating records in Mavis has been synonymous with filmographic cataloging. 
It is a large and advanced system holding all our audiovisual metadata (recorded sound, photographies, moving images, +++). 
However, it does not offer a good way of describing objects without also describing their content. 
It is a product of a content focused descriptive framework. 
It is also a product of its time (it's old).

Mavis operates with a three-level hierarchy of description using the entities *title*, *component* and *carrier*[^2]. 
It is a non-standard data model, but not that different from more modern metadata models (e.g., FRBR/LRM, EN15907, FIAFcore[^12]. 

Compared to FRBR/LRM/FIAFcore:

- The **title** entity tends to hold data on film works and *expressions/variants*. 
- The **component** describes a *logical whole* of **carriers** (e.g., a film copy consisting of multiple reels/carriers). Comparable to the *item*.
- The **carrier** describes the tangible object (e.g., an individual film reel). 
Matching the carrier in FIAFcore (no equivalent in FRBR/LRM, unless you start modelling some wonky item-to-item relations.[^11]

```
      MAVIS                                FIAFCORE
   DATA MODEL                             DATA MODEL
┌───────────────┐                      ┌───────────────┐
│     TITLE     ├─────────────────────▶│ WORK--VARIANT │░
│               ├░─ ─ ─ ─ ─            │               │░
└───────┬───────┘░         │           └───────┬───────┘░
 ░░░░░░░│0..1░░░░░                      ░░░░░░░│░░░░░░░░░
        │                  │                   │
        │                                      │
        │                  │           ┌───────┴───────┐
        │                   ─ ─ ─ ─ ─ ▶│ MANIFESTATION │░
        │                   ─ ─ ─ ─ ─ ▶│               │░
        │                  │           └───────┬───────┘░
        │                               ░░░░░░░│░░░░░░░░░
        │                  │                   │
        │0..n                                  │
┌───────┴───────┐          │           ┌───────┴───────┐
│   COMPONENT   ├░─ ─ ─ ─ ─            │     ITEM      │░
│               ├──────────┬──────────▶│               │░
└───────┬───────┘░         │           └───────┬───────┘░
 ░░░░░░░│1░░░░░░░░         │            ░░░░░░░│░░░░░░░░░
        │                  │                   │
        │1..n              │                   │
┌───────┴───────┐          │           ┌───────┴───────┐
│    CARRIER    │░         └──────────▶│    CARRIER    │░
│               ├─────────────────────▶│               │░
└───────────────┘░                     └───────────────┘░
 ░░░░░░░░░░░░░░░░░                      ░░░░░░░░░░░░░░░░░
```


### Mavis-specific limitations
I've talked a lot about the concept of a *content framework*, but that does not mean that Mavis doesn't hold information about material objects. 
On the opposite, it holds very detailed carrier metadata with technical format information, treatment and condition data, movement information, provenance information etc. 
The problem is that Mavis also has some severe technical limitations: 

- It is **impossible** to create a carrier record not attached to a component record
- It is **impossible** to move a carrier record between component records
- It is **impossible** to merge/split component records

As a result:

- It is **impractical** to create a component record without having first identified its exact carrier composition or attaching it to a title record. 

For these reasons, we have tried to avoid creating records for carriers that we could not identify the content of. 
As it is difficult to get unidentified material into Mavis, such material has usually been described in various lists and Excel spreadsheets. 
I should not have to say it, but Excel spreadsheets are not a good long-term solution for managing something for posterity.

## Cataloging vs. description
I've been banging my head against these challenges for years. 
How on earth can we get more of our collection catalogued, without getting a huge influx of resources? A quirk of our institution(?) is that we have no dedicated moving image cataloguers. 
It is one of many hats our archivists wear, while the usual feeling is that it is one of the areas where we accomplish too little. 
Still, you have the resources you have, and need to make the best of it[^3].

A sudden decision to close an old vault and move thousands of uncatalogued film reels forced us to try and come up with a solution. 
A result of that process was that I became more aware of the intellectual and technical frameworks we were working within. 

An important realization was that "cataloging" is loaded terminology within our organization (perhaps everywhere?). 
Due to the mentioned technical limitations, and us having content focused descriptive goals, what we call cataloging is actually a very specific thing: a defined minimum of description. 
If something did not meet that minimum, it was not cataloging. 
One of the requirements was content identification. 
In most cases that would mean creating and/or relating an object to a title record. 
Another way of putting it is that "cataloging" is understood as what you do in a "catalog". 

In one way, this is just semantics, but to make things simpler, I talk less about "cataloging" and instead use terms like "description" or "metadata creation". 
It allows me to sidestep unnecessary confusion stemming from terminology within the organization. 

For the very same semantic reason I have tried to be adamant in describing systems like Mavis (and it's future replacement) *not* as "catalogs", but rather as "Collection Management Systems". 
These systems have metadata handling at their core, but they are not mere repositories for metadata. 
They tend to have extended functionality for solving a whole range of tasks. 
The "catalog" is just a small part of these larger systems.

Using this alternative terminology though, it immediately becomes clear that both the metadata found in Mavis for "catalogued" material, and the metadata found in our Excel spreadsheets are *descriptions*. 
These two types of description are not the same, but they are both valid and valuable.

## Resources and goals
This touches on my second realization: we need realistic (and practical) descriptive goals. 
Again, this could seem obvious, but let's consider the amount of "uncatalogued" material in our collection, that is currently managed in spreadsheets and lists. 
We have tried - and failed - to describe this in the Mavis-manner for years. 
It is unrealistic to fully describe all of our collections at this level of detail. 
We simply do not have the resources for it.

Still, most of this "uncatalogued" material *has* been described in the aforementioned spreadsheets. 
That level of description is, in other words, realistically achievable! The spreadsheets have various levels of detail, but in their essence, what they contain is *carrier* level metadata. 

Identifying content usually requires you to assess the material in some detail, winding through a film reel, for example. 
There is however a lot of carrier level metadata you can determine with high degrees of certainty, with a more basic assessment. 

Here are some examples of data you can create with a mere superficial inspection of a film object:

- What is the material's provenance? How did it enter your collection? Who gave it to you? 
- What does it say on the can? 
	- The *title proper* of a film *can* is true regardless of what the can actually contains. 
    E.g., even though the film reel turns out to be a reel of film work "X", it still true that it said "Y" on the can.
- What is the general format? E.g., is it film, is it video? Is it 35 mm or 16 mm?
- What is its general condition? E.g., is there mold in the can?
- Give the object a unique ID. E.g., attach a barcode

## Defining realistic minimums
What I'm trying to get at, is that you can operate with different description requirements in *different stages* of description. 
You should operate with different and achievable minimums at different stages. 

> Principle: Establish achievable and practical descriptive goals.

By stages I do not necessarily mean successive steps in a workflow, but rather different events that results in new metadata. 
They can be concerted cataloging events, like accessioning, but they can also be simple material handling events. 
The important part is that some new metadata appears. 

You can describe extensively or barely at all. 
The amount of metadata you *need* to create depends on what you want to achieve with it. 
There needs to be *proportionality* between the metadata requirement and the stage it is created in. 
Regardless of the *ideal/wanted* level of detail, you still need to establish a *minimum* level of description. 
However, it's a good idea to establish a best practice level as well![^4]. 

## Successive, iterative description

Minimum metadata entered in one stage, serves as the basis for further enrichment in another. 
I have tried to illustrate it in the basic illustration below. 

```
      STAGE 1    ───────▶     STAGE 2    ───────▶     STAGE 3    ───────▶     ETC.

┌────────────────┐      ┌────────────────┐      ┌────────────────┐
│░░░░ Record ░░░░│░     │░░░░ Record ░░░░│░     │░░░░ Record ░░░░│░
├────────────────┤░     ├────────────────┤░     ├────────────────┤░
│Attribute 1: "X"│░     │Attribute 1: "X"│░     │Attribute 1: "X"│░
│Attribute 2:    │░     │Attribute 2:    │░     │Attribute 2: "Y"│░
│Attribute 3: "Z"│░     │Attribute 3: "Z"│░     │Attribute 3: "Z"│░
│Attribute 4:    │░     │Attribute 4: "A"│░     │Attribute 4: "A"│░
│Attribute 5:    │░     │Attribute 5:    │░     │Attribute 5: "B"│░
│Attribute 6:    │░     │Attribute 6:    │░     │Attribute 6: "C"│░
└────────────────┘░     └────────────────┘░     └────────────────┘░
 ░░░░░░░░░░░░░░░░░░      ░░░░░░░░░░░░░░░░░░      ░░░░░░░░░░░░░░░░░░
```

For example: Stage 1 is the point where a record is first created. 
Attributes 1 and 2 are the minimum metadata attributes that should be filled out during this type of record creation stage. 
Stage 2 is an inspection event that looks at material where Attribute 3 = "Z", and creates metadata for attribute 4. 
Stage 3 is a more extensive cataloging event that creates a range of other metadata. 
I haven't included it in the drawing, but existing attributes can of course also be changed.

You can work with different descriptive frameworks at different points. 
Similarly, different attributes can be added by different people at different points. 
There is no need to do everything at once.

> Principle: Cataloging is a *successive* and *iterative* process. 
You build metadata over time. 


## Creating records at the right time
A misunderstood cataloging principle, that I've encountered, is that you should only describe an object *once*. 
It goes completely against my previous principle. 
I find it untenable, as it means you would have to figure out everything there is to know about an entity at the time of its *first* description.

In practice, you often describe the same objects over and over, but it is not (necessarily) the same *attributes* you change over and over. 
Some attributes also change over time. 
Cataloging is not a static one-time event, but rather a living process of enrichment. 
You start with a minimum (or slightly more), and you build from that. 
This is what I mean with cataloging as a successive, iterative process.

What we should avoid though, is first creating a descriptive record in one system (e.g., a spreadsheet) and then at a later point create a new descriptive record for the same object in another system (e.g., a cataloging system). 

Something to strive for then, is not to describe something only once, but rather to describe it in the correct *manner* and in the correct *location* right away. 
Create a record and start describing the moment a new object crosses your doorstep and enters your collection. 
Do this in a way that allows you to enrich the record over time. 
Avoid parallel descriptions in multiple locations, and do not allow conflicting description to appear in different locations.

>Principle: Create metadata *records* in the right location and manner, as early as possible in a collected object's archival life. 

## The tangible carrier
I'm very fond of the carrier as a concept. 
It refers to something specific in Mavis, but I have adapted the term more widely to represent the *smallest* described tangible size in any of our metadata systems[^5]. 
Because the carrier represents an actual tangible object (both analog and digital), it is a very persistent cataloging entity. 
Our carriers are rarely split or merged. 

*Content*, on the other hand, is an abstract concept, and thus open to (much more) interpretation. 
The higher-level cataloging entities used to describe content and other more abstract concepts (works, expressions, manifestations, etc), are thus often subject to change. 
Content identification is fleeting.

In theory, a carrier could be described in multiple different hierarchies in parallel. 
A carrier such as a film reel, could for example be described both as filmographic content (FIAFcore hierarchy) *and* as an archival object in an archival database (ISAD(G) hierarchy). 
I have aired this idea a few times and believe this is something to work for in the long-term, but let's not get carried away completely!

```
"CONTENT HIERARCHY"               "ARCHIVAL HIERARCHY"
 ┌───────────────┐                 ┌───────────────┐
 │WORK-EXPRESSION│░                │     FONDS     │░
 └───────────────┘░                └───────┬───────┘░
  ░░░░░░░│░░░░░░░░░                 ░░░░░░░│░░░░░░░░░
         │                                 │
 ┌───────┴───────┐                 ┌───────┴───────┐
 │ MANIFESTATION │░                │    SERIES     │░
 └───────────────┘░                └───────┬───────┘░
  ░░░░░░░│░░░░░░░░░                 ░░░░░░░│░░░░░░░░░
         │                                 │
 ┌───────┴───────┐                 ┌───────┴───────┐
 │     ITEM      │░                │    FOLDERS    │░                       ETC.
 └───────────────┘░                └───────────────┘░
  ░░░░░░░▲░░░░░░░░░                 ░░░░░░░▲░░░░░░░░░                        ▲
         └────────────────┬────────────────┴─────────────────────────────────┘
                  ┌───────┴───────┐
                  │    CARRIER    │░
                  └───────────────┘░
                   ░░░░░░░░░░░░░░░░░
```



## Optional attributes
Let's return to the problem of getting objects described in our systems. We have established a few guiding principles and thus want to:

- Describe material early in its archival life
- Describe material in the right place
- Create a proportional amount of metadata at a time
- Enrich metadata over time

We have established a few realistic minimums in our lists. 
That minimum does not include content identification. 
We also know what description model we want to operate with and what system we want to get the metadata into.

Usually, content identification of a tangible object is no more than the existence of a relation between the cataloging entity describing the object and a cataloging entity describing its content. 
A simple data model change making that attribute **optional** allows for much greater flexibility in description. 
In Mavis we would therefore have liked to allow carriers to exist as *orphans*.

### Mavis-specific workaround
Sadly, making that data model change in Mavis is not feasible. 
The limitations highlighted earlier are in practice hardcoded, and these are not the only limitations. 

However, we knew Mavis would need to be replaced at some point. 
While these proposed principles have not been spelled out before here in the National Library, they were reflected in the system specifications made for the tender for a Mavis-replacement system in 2021[^6]. 

Even though we didn't know *what* would replace Mavis, we knew that the system would be replaced. 
We *required* that the replacement system would have a more flexible data model. 
We also knew that we would have to migrate and manipulate our metadata soon in the expected migration process. 
In other words, we could make some short-term compromises. 


### Orphaned components and carriers
What we decided on was to create orphaned *components* with a single carrier. 
In reality these function as orphaned carriers. 
They describe single objects (reels, tapes etc.), but must be represented as two entities (component and carrier) in Mavis due to system limitations. 

In some cases, we will create orphaned components with multiple carriers. 
These are cases when it is easy to do component identification, or we have to split things due to practical reasons and don't want to lose the original relation between the carriers (these things came to us as a single entity after all). 

Using this method, we started a systematic effort to get previously *completely undescribed* material (material on pallets, not even on lists) into Mavis. 
In this process every carrier would be barcoded (so that we could get it into our logistics systems), simply described, and photographed (to capture any visual metadata not captured by our simple descriptions[^7]). 
It has proven very effective.

#### Short-term drawbacks
In the short-term there are some drawbacks. 
Due to the limitations related to the component highlighted earlier, it is hard to enrich the metadata in Mavis. 
Changing component composition is not doable, without an arduous manual job of deleting and creating records, combined with shuffling around lots of metadata. 

Another issue is that Mavis puts a lot of metadata we have come to view as carrier metadata at the component level, while not really supporting multiple cardinality of certain attributes. 
This means (manually) merging these orphaned components results in metadata not having anywhere to go. 

Attaching material to titles is perfectly doable though, and for components that only consist of a single carrier, it almost works as intended!

My view is that we should avoid tampering with this metadata too much while we are still operating within Mavis. 
We are replacing the system, and at some point these records will have their metadata shuffled around. 
Most importantly the changes we would like to make to the data, will be much easier to perform in a new system. 
There is no reason to rush things in a manner that causes issues. 
It is often stated in our organization, that we work in a thousand-year perspective, but we still tend to hurry in unconstructive ways... 

## Towards a new data model and system
The tender process for the replacement of Mavis concluded in 2022, with Axiell being awarded the contract[^13] with their *Collections* system. 
We are still in the middle of implementation, hoping to go live during 2024. 

In this project we are implementing a unified and flexible data model for all our audiovisual metadata. 
This model aims to be compatible with both IFLA LRM and the FIAF cataloging manual (with FIAFcore coming to play a more important role). 
I have high hopes for the implementation and there is a myriad of new opportunities here that we are probably not even seeing yet.

The model we are trying[^8] to implement looks like this[^9]:

```
NLN AV DATA MODEL
┌───────────────┐
│WORK-EXPRESSION│░
└───────┬───────┘░
 ░░░░░░░│0..n░░░░░
        │
        │
        │0..n
┌───────┴───────┐
│ MANIFESTATION │░
└───────┬───────┘░
 ░░░░░░░│1░░░░░░░░
        │
        │
        │0..n
┌───────┴───────┐
│     ITEM      │░
└───────┬───────┘░
 ░░░░░░░│0..1░░░░░
        │▲
        │└─────────────── OPTIONAL CONTENT IDENTIFICATION!
        │1..n
┌───────┴───────┐
│    CARRIER    │░
└───────────────┘░
 ░░░░░░░░░░░░░░░░░
```

## Benefits
I want to round off this post by looking at what we can achieve by following these principles. 

I hope I have highlighted some of the key benefits already: greater flexibility and realism in cataloging. 
New ways of working enabling better use of resources.

In more concrete terms, working in this manner has already enabled us to get better control of our unidentified materials. 
It allows for managing more material in one place and in the same manner. 
We can use existing controlled vocabularies and controlled fields etc. 

To use the FRBR aims again: it enables us **find**, **identify**, **select**, and **obtain** more of our collection in the same manner, and thus more easily.

Furthermore, having more material in the same system allows us to utilize more of the existing system infrastructure in our organization. 

A concrete example: the systems managing our new robotic freezer vault[^10] is integrated with Mavis. 
The existence of a Mavis record is a requirement for anything being put in the vault. 
Getting material into Mavis is thus a requirement for getting material into better storage conditions.

My overarching goal here is to create a framework for great cataloging in the long-term. 

## Clarity of limitations
Of equal, or perhaps more, importance is knowing the limitations of what you are doing (see footnote 4). 

> Principle: Be honest about what you are accomplishing.

In our example of orphaned carriers, we do not achieve content descriptions. 
We only achieve descriptions at the bottom-level of a complex 4-level hierarchy. 
Content descriptions are complicated, but also expected of many of our end users. 
I need to stress that good content descriptions should still be the end goal for most of our material! 

What we have accomplished is easing the first, tiny step in description. 
The descriptive work is not done however! Metadata never appears magically out of nowhere, and has to be created somehow. 
Losing track of this will lead to disaster.

I believe we can accomplish more and better descriptions over time, by not mixing unrelated processes together. 
That does not mean we are not interested in all the processes!


[^1]: Personally, I'm more of a Kittlerian fundamentalist. 
Matter and technology are not only a precondition for the content, it *is* the content. 
I don't think it makes much sense to talk of one without the other.

[^2]: The Mavis metadata model is quite a bit more complex than this, but these three entities sit at its core. 
Out of curiosity, I made an attempt to type out a more complete Mavis-data model in mermaid below. 
It is done by memory and is still incomplete, but at least it illustrates the model's complexity quite well: 

    [{{< figure src="mavismermaid.png" alt="mavis data model" >}}](https://mermaid.live/edit#pako:eNqVlU1zgjAQhv8Kk7M6-AXCudeeeusww0RYNS1JaBI6pcJ_byQgotFKTvl43t1Ndid7RAlPAYUoYiBeCN4LTCMWqYKRHRc0VkRl4NR8OuVHxyxC54BlDD-5ACkJZxFz9JAgCEgbmWOhYr6LDWGjh87uq8x5ZUQJpzlnwFQrOK8vWUs4EvbUTp0tdMy15aH2Fq__iazXR6qHqmo6rbQKC31T0WnM6spT7yEvCdvHByIVF-XZT162gtbWk7g12bLYfkDS3aFdWV7tATfM8gPw5oICEi7SOMNbyFpBM-_wLNNaXXvm8aqbJ--qpyfvKXHyVRBJmq3H2kvyH7cX6IMXZph2RYn39pK0I5ZI7OBVkVUOfPfBNnPDme0nwjqZadKzAwEsgZhipZOMuySdD2z-xwjbAh7tb5DeEcrm0iM1bXmPVA1LYaT4OvNPStEEURAUk1T_9MeTqQipA1CIUKinKRafke4AteZwofhbyRIUKlHABBV5qs22nQGFO5xJvZtj9s457SBIif5YXk0naRpKg6DwiH5QGASzYLHxXNdbbTaB764nqEThMpj5vjffrH1_6S9XXj1Bv43J-WzunsbCWyw8d7X06z9_vVhq)

[^3]: During a talk about the state of crisis in film archives at the FIAF congress in Lausanne 2019, someone (Tiago Baptista?) asked the audience to raise their hands if they felt their institution has adequate funds. 
Of course, no one raised their hands, regardless of the size or wealth of their institutions. 
Everyone has larger ambitions than their resources allow. 
I think it is quite illustrative. 
For me the point is to do as much as you can with what you have. 
Don't stop striving for more though!

[^4]: This talk about minimums is not without danger. 
I believe good metadata is one of the most underappreciated resources in most archives - at least in terms of budgets! I'm not arguing for a race to the bottom in terms of metadata quality. 
I'm rather trying to highlight the need for assessing what is essential to describe at what point in time, and to reflect over the use of your available resources. 
E.g., work in ways that allow you to enrich data, capture "cheap" metadata that you already are producing, etc. 
Metadata production happens all the time, and a lot of it is produced by non-catalogers. 
If you do advanced cataloging the required minimum is necessarily equally extensive. 
Needless to say, if you let the wrong people (for example those in charge of funding) define the cataloging minimums though, you are in trouble...

[^5]: For digital objects, we might at some point introduce the concept of a file-entity under the carrier. 
On the other hand, this could be an unnecessary level of detail in our primary collection management systems. 
The implementation needs to be proportional to the needs it's supposed to fill. 
Pragmatism is key.

[^6]: Some of these thoughts have been marinating in my head for years. 
I've been involved with the Mavis replacement work since 2018. 
Before that I spent some time evaluating the FIAF cataloging manual/EN15907, and whether we could realistically implement any of it in our current system. 
The lack of the carrier entity in EN15907 confused us to no end.

[^7]: These photos are linked to a barcode, and will be linked to the carrier record - and viewable! - in our new collection management system. 
It could also potentially be OCR treated at some point, for a further enrichment of metadata down the line.

[^8]: There is still some uncertainty surrounding the "many"-part of the "zero to many"-relation between a manifestation and a work-expressions. 
Having multiple parents in a hierarchy is possibly impractical within Axiell Collections. 
Thus, we could be touching upon a limitation in our new technical framework.

[^9]: Here is the same model formated in mermaid with some additional important relationships added: 

    [{{< figure src="nlnmermaid.png" alt="nln data model" >}}](https://mermaid.live/edit#pako:eNp9kcFugzAMhl8F-UwRhaRpct51p92mSJNVvDWqSJBJt3bAuw8ondSt6s3-8_22Y3ewCxWBAeuJnxx-MNbW2_gV-LCiU8PUti74ZAirVeiSGr17pzZinEST7LF9u9Em7y3U97PTRaoXwxRO3Cz1Y-G-S3bI7IgXYskm6PowhCwL_7jQnO9N21_gv_LF9Ins0Mf7v3zga5AfmW4no1OkqQekUBPX6Kpxx531SWIh7qkmC2YMK-SDHXc_jBweY3g5-x2YyEdK4dhUGGm5yVVs0L-G8JtS5WLg58sJ50vOCJgOTmBKIbNSSrUutlLoohQqhTMYqTKl8mJd5GutlZbFkML3XDTP1FYXGyFELsuN0Hr4AV_nvcY)

[^10]: See page 21 of [FIAF Bulletin Online #25, June 2023](https://www.calameo.com/fiaf/read/0009185400e6b798e58f0)

[^11]: Using RDA attributes you could model an item-carrier relationship using the a [rdai:P40080](http://www.rdaregistry.info/Elements/i/#P40009)-attribute. 
I really dislike like the possible clutter such an optional catalog entity could create though. 
The same entity operating in two different ways and a hierarchy that sometimes has entities that do different things depending on how they are related to each other, increases the complexity of system integrations and data exchanges.

[^12]: [FIAFcore](https://fiafcore.org)

[^13]: ["Axiell Collections chosen by National of Norway to manage Norways largest collection of audiovisual materials"](https://www.axiell.com/blog-post/axiell-collections-chosen-by-national-library-of-norway-to-manage-norways-largest-collection-of-audiovisual-materials/)