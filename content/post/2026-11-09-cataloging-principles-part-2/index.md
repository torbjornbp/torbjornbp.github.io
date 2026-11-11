---
title: Practical cataloging principles, part 2
date: '2026-11-09'
draft: true
description: Further practical cataloging principles about descriptive meaning, evidence, digital objects, and the questions metadata should help us answer.
categories:
  - cataloging
tags:
  - Film cataloging
  - Asset management
  - cataloging
---

In [my previous post about practical cataloging principles](https://torbjorn.no/post/2023/10/20/practical-cataloging-principles/), I tried to spell out some of the principles behind my approach to cataloging. Much of that text concerned getting material described in the first place. We should be able to register an object without first identifying its content, and we should work in ways that allow us to enrich the description over time.

This time I want to look more closely at how we structure that metadata. What are we describing, which characteristics do we record, and how do we relate the descriptions to each other? These choices affect what we can find out about our collections. If we mix different descriptive questions together, or leave unclear what a record represents, we may struggle to answer questions even when the relevant information has been recorded.

I’ve been working on the [FIAFcore ontology](https://github.com/FIAF/fiafcore) and the [FIAF Cataloguing Manual](https://github.com/FIAF/fiaf-cataloguing-manual). This work has forced me to think more closely about how we structure metadata, and made me want to spell out a few more cataloging principles.

## What is the metadata for?

In the previous post I argued that the amount of metadata you need to create depends on what you want to achieve with it. This also applies to *how* you describe something. You can create a lot of detailed metadata and still struggle to answer fairly basic questions about your collection.

For example:

- How many release prints do we hold?
- Which release prints are designated as preservation copies?
- How many nitrate elements remain unexamined?
- Which films have digital access copies?
- How much storage do we use for our digital objects, including their maintained copies?

Before settling on a way of describing the material, we should consider what we would need to record to answer these questions. We need to know which objects to count, what their recorded characteristics mean, and how to connect the relevant descriptions.

It is useful to work through an example. If we select all records marked “release print,” what will the result contain? Does our way of describing the material allow us to distinguish the prints from their individual reels, and their original function from their current institutional status?

> **Principle: Test your descriptions against the questions they need to answer.**

We cannot anticipate every future use of our metadata. Still, the questions we already want to answer give us somewhere practical to start. They also give us a way of testing whether the distinctions we make in our descriptions are useful.

## What are we counting?

When we ask how many release prints we hold, we probably do not want to know how many database records have “release print” selected somewhere. We want a count of prints. Whether those are the same number depends on how the material is described.

A print consisting of several reels might have descriptions of both the complete copy and its individual reels. If “release print” is recorded for each reel, counting those records will give us a different answer from counting complete copies. The reel count can be useful too, but we need to know which question we are answering.

In [Part 1](https://torbjorn.no/post/2023/10/20/practical-cataloging-principles/#optional-attributes), I argued for describing objects even when we cannot yet identify their content. That distinction matters here as well. We may know how many reels we have without knowing how many film copies they belong to, or which films they represent. These are different things we can establish at different points in description.

> **Principle: Be clear about what each description represents.**

For digital material, a file count presents a similar problem. One digital object may consist of several related files. It may also have maintained copies in different storage locations. Counting files or storage instances can help us manage the storage, but neither count automatically tells us how many digital objects we hold.

This does not require every institution to use the same record structure. We do need to distinguish the units within the structure we use, and make their relationships clear enough to support the queries we want to run. If several reel records belong to one print, we need a way of recognising that association when counting prints.

Where that association has not yet been established, the uncertainty should remain visible. We can report the reels we have registered without pretending that we have also established the number of complete copies or identified films.

## What do the categories mean?

Knowing what we are counting is only part of the problem. We also need to know what the recorded characteristics tell us about those objects.

Consider a list containing “release print,” “nitrate,” “preservation,” and “MP4.” These terms might all be useful in a description, but they answer different questions. They concern an object’s original function, its support material, its current institutional designation, or its technical form.

If we can select only one value, we immediately have a problem. A nitrate release print retained for preservation fits several of these descriptions. Choosing “preservation” should not mean losing the information that it is a release print, or that its support is nitrate.

Allowing several values may solve that immediate recording problem. Still, we need to establish what each value asserts. Otherwise, consistent-looking records may contain inconsistent descriptions.

> **Principle: A descriptive category should answer a clearly defined question.**

For example, we can distinguish the question “Why was this object made?” from “What status does it have within our institution?” Keeping a release print for preservation does not change its original function. Both statements remain useful, particularly if we want to find release prints designated as preservation copies.

The same care is needed when writing guidance. Asking someone to record an object’s “type” is not much help unless we explain what kind of distinction we mean. A familiar field name does not necessarily make its meaning clear.

This does not require every vocabulary to be equally detailed. A broad term can be the appropriate choice when that is all the evidence supports. More specific terms can coexist with it, provided they answer the same descriptive question.

Nor does each distinction necessarily require a separate database field. The important part is that the meanings remain distinguishable and that we can record the relevant statements together. We should then be able to query their combination without having to guess what the cataloger meant.

## Relationships and bottom-up description

In [Part 1](https://torbjorn.no/post/2023/10/20/practical-cataloging-principles/#the-tangible-carrier), I distinguished descriptions of the objects we hold from descriptions of their content. The object description can persist while our understanding of its content changes. We might identify an unknown reel, reconsider which version it belongs to, or discover that reels we thought belonged together do not.

This is part of what I mean by a bottom-up approach to cataloging. We start with the material and the evidence available about it, and use that information to build and refine the intellectual descriptions. A model drawn with Work at the top and Item at the bottom does not mean that description has to proceed from the top down.

Relationships allow us to connect these descriptions and ask questions across them. But we need to be clear about what following a relationship lets us conclude.

For example: which films do we hold complete copies of? Identifying the film associated with a print is one part of the answer. Establishing the completeness of that particular print is another. A relationship to the film does not supply the missing assessment.

The same distinction applies to individual characteristics. A release may be documented as running for 90 minutes, while an incomplete print runs for 60. The release duration can provide a reference for assessing the print. It should not replace the print’s actual duration. Nor should the incomplete print’s duration become the release duration simply because we are working from the bottom upwards.

> **Principle: Be clear about what relationships establish.**

This does not mean entering the same information repeatedly. We can reuse applicable information through relationships, provided we know what it describes and whether it applies to the object in question. We need to preserve the difference between a shared description, an observation about a particular object, and something we have not yet established.

That difference also needs to survive the query. A film for which completeness has not been assessed is not necessarily a film for which we hold no complete copy. If we report only confirmed complete copies, we should be clear that this is what the result represents.

## Deciding what to describe next

Getting material registered gives us something to build on. As I argued in Part 1, we can start describing objects before we know everything about them. But we still need to decide how to develop those descriptions, especially when there is more work to do than we have resources for.

The questions we want to answer can help us make those decisions. A count of registered reels requires different metadata from a list of films for which we hold complete copies. The latter also requires content identification, the relevant relationships, and an assessment of completeness.

If we cannot answer a question, we should therefore look at what is missing. Do we need to register more material? Identify its content? Examine the copies? Or is the information already recorded in a way that makes it difficult to retrieve?

Those are different kinds of work. Establishing which questions matter, and what prevents us from answering them, gives us a basis for prioritising that work. Sometimes the useful next step will be a basic registration effort. Sometimes it will be more detailed examination, or making existing descriptions usable together.

Our needs will also change over time. Questions we were not particularly interested in when we first described the material may later become important. We therefore need to return to our descriptions and reassess whether they contain the information we now need, and whether we can retrieve and combine it in useful ways. Sometimes we will need additional metadata. Sometimes we will need to reconsider how existing information is structured or related. Prioritising metadata work is thus something we need to do repeatedly, as our questions and our knowledge of the collection develop.

The aim is to make deliberate choices about what to describe next, while being clear about which questions we can already answer and which still require work.
