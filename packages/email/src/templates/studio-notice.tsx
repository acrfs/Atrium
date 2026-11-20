// Shana Studios: a plain studio-styled message (local modification, see MODIFICATIONS.md).
import { Body, Container, Head, Heading, Html, Link, Preview, Text } from "../studio";
import * as React from "react";

interface StudioNoticeEmailProps {
  heading: string;
  paragraphs: string[];
  buttonLabel?: string;
  buttonUrl?: string;
}

export function StudioNoticeEmail({ heading, paragraphs, buttonLabel, buttonUrl }: StudioNoticeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body>
        <Container>
          <Heading>{heading}</Heading>
          {paragraphs.map((text: string, i: number) => (
            <Text key={i}>{text}</Text>
          ))}
          {buttonLabel && buttonUrl && (
            <Link href={buttonUrl} style={{ display: "inline-block" }}>
              {buttonLabel}
            </Link>
          )}
        </Container>
      </Body>
    </Html>
  );
}
