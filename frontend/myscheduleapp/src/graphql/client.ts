// src/graphql/client.ts
import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GRAPHQL_URL } from '../config/env';
import { getAccessToken } from '../utils/secureStore';

// Apollo Client 4.2+ requires app-wide default options to be declared in the types: the
// `errorPolicy: 'all'` default below is declared here. Declaring any default also switches
// every hook to Apollo's new "modern" generic signatures, which the existing screens
// (useQuery<Data>(...)) aren't written for yet, so we keep the "classic" signatures —
// Apollo's documented migration path. Types only: runtime behaviour is unchanged.
declare module '@apollo/client' {
    namespace ApolloClient {
        namespace DeclareDefaultOptions {
            interface Query {
                errorPolicy: 'all';
            }
        }
    }
    export interface TypeOverrides {
        signatureStyle: 'classic';
    }
}

const httpLink = createHttpLink({ uri: GRAPHQL_URL });

const authLink = setContext(async (_, { headers }) => {
    const token = await getAccessToken();
    return {
        headers: {
            ...headers,
            Authorization: token ? `Bearer ${token}` : '',
        },
    };
});

export const apolloClient = new ApolloClient({
    link: authLink.concat(httpLink),
    cache: new InMemoryCache(),
    defaultOptions: {
        query: {
            errorPolicy: 'all',
        },
    },
});